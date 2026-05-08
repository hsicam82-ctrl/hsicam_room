import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import OpenAI from "openai";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dotenv.config();

const PORT = 3000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Importance = "high" | "mid" | "low";
type ArticleType = "approval" | "clinical" | "deal" | "earnings" | "pricing" | "legal" | "finance" | "product" | "etc";

interface Article {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  rssPublishedAt: string | null;
  publishedAtSource: string;
  fetchedAt: string;
  source: string;
  content: string;
  isStarred: boolean;
  isRead: boolean;
  aiAnalyzed: boolean;
  type: ArticleType;
  importance: Importance;
  reason: string;
  summary: string;
  memo: string;
  telegramSent: boolean;
  entities: {
    companies: string[];
    products: string[];
  };
}

interface WebSource {
  name: string;
  url: string;
  baseUrl?: string;
  itemSelector: string;
  titleSelector: string;
  linkSelector: string;
}

// --- Apps Script Bridge Service ---
class GoogleSheetBridge {
  private url: string;
  private secret: string;
  private cache: { data: Article[]; timestamp: number } | null = null;
  private CACHE_TTL = 30 * 1000; // 30 seconds

  constructor() {
    this.url = process.env.GOOGLE_SCRIPT_URL || "";
    this.secret = process.env.GOOGLE_SCRIPT_SECRET || "";
  }

  private async request(method: "GET" | "POST", payload: any) {
    if (!this.url) {
      console.error("[Bridge Error] GOOGLE_SCRIPT_URL is missing in Environments/Secrets.");
      return null;
    }
    try {
      // Use POST for most actions if possible as it's more robust with GAS
      // We'll keep the original method but default to POST if it helps
      const isPost = method === "POST" || payload.action === "getMetadata" || payload.action === "getArticles";
      
      if (isPost) {
        const res = await axios.post(this.url, { ...payload, secret: this.secret }, { 
          timeout: 45000, 
          headers: { "Content-Type": "application/json" } 
        });
        this.cache = null; // Clear cache on write
        return res.data;
      } else {
        const res = await axios.get(this.url, { params: { ...payload, secret: this.secret }, timeout: 45000 });
        return res.data;
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        console.error(`[Bridge Error] 401 Unauthorized: Check if GOOGLE_SCRIPT_SECRET matches SECRET_TOKEN.`);
      } else {
        console.error(`[Bridge Error] ${payload.action}:`, e.message);
        if (e.response?.status === 500) {
          console.error(`[Bridge Tip] 500 error from GAS often means a missing sheet (e.g., "metadata") or script exception.`);
        }
      }
      return null;
    }
  }

  async getArticles(): Promise<Article[]> {
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.data;
    }

    const data = await this.request("GET", { action: "getArticles" });
    if (!Array.isArray(data)) return [];
    
    const articles = data.map(r => ({
      ...r,
      isStarred: String(r.isStarred) === "true",
      isRead: String(r.isRead) === "true",
      aiAnalyzed: String(r.aiAnalyzed) === "true",
      telegramSent: String(r.telegramSent) === "true",
      entities: typeof r.entities === "string" ? JSON.parse(r.entities) : (r.entities || { companies: [], products: [] })
    }));

    this.cache = { data: articles, timestamp: Date.now() };
    return articles;
  }

  async getNotifications() {
    const data = await this.request("GET", { action: "getNotifications" });
    return Array.isArray(data) ? data : [];
  }

  async getMetadata(key: string) {
    return await this.request("GET", { action: "getMetadata", key });
  }

  async updateRow(sheetName: string, idField: string, idValue: string, data: any) {
    return await this.request("POST", { action: "updateRow", sheetName, idField, idValue, data });
  }

  async syncArticles(articles: Article[]) {
    return await this.request("POST", { action: "syncArticles", data: articles });
  }

  async clearAll() {
    return await this.request("POST", { action: "clear" });
  }
}

const bridge = new GoogleSheetBridge();

// --- Scraping & Intelligence ---

const INDUSTRY_KEYWORDS = ["제약", "바이오", "신약", "의약품", "임상", "품목허가", "식약처", "FDA", "기술이전", "허가", "승인", "치료제", "백신", "헬스케어"];
const EVENT_KEYWORDS = ["실적", "영업이익", "임상", "허가", "승인", "기술이전", "계약", "수주", "급여", "약가", "특허", "시판", "출시", "인수", "합병", "공개", "발표"];

const RSS_SOURCES = [
  { name: "약사공론", url: "https://www.kpanews.co.kr/rss/allArticle.xml" },
  { name: "팜뉴스", url: "http://www.pharmnews.com/rss/allArticle.xml" },
  { name: "매일경제", url: "https://www.mk.co.kr/rss/30000023/" },
  { name: "히트뉴스", url: "https://www.hitnews.co.kr/rss/allArticle.xml" },
  { name: "메디파나뉴스", url: "https://www.medipana.com/rss/allArticle.xml" },
];

const WEB_SOURCES: WebSource[] = [
  { name: "바이오스펙테이터", url: "http://www.biospectator.com/section/section_list.php?code=1100", baseUrl: "http://www.biospectator.com", itemSelector: ".article_list > li, .list > li", titleSelector: ".article_title a, .tit a", linkSelector: "a" },
];

interface SourceStatus {
  source: string;
  method: "RSS" | "dedicated" | "web";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  success: boolean;
  candidateCount: number;
  savedCount: number;
  error?: string;
  timeout?: boolean;
}

const parser = new Parser({ 
  headers: { 
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  }, 
  timeout: 10000 
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, sourceName: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`Timeout exceeded for ${sourceName}`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

async function fetchRssSource(source: { name: string; url: string }): Promise<Article[]> {
  const feed = await parser.parseURL(source.url);
  return feed.items?.map(i => normalizeArticle({ 
    title: i.title || "", 
    link: i.link || "", 
    source: source.name,
    rssPublishedAt: i.isoDate || i.pubDate || null
  })) || [];
}

async function fetchWebSource(source: WebSource): Promise<Article[]> {
  const { data } = await axios.get(source.url, { 
    timeout: 10000, 
    headers: { 
      "User-Agent": USER_AGENT, 
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    } 
  });
  const $ = cheerio.load(data);
  const items: Article[] = [];
  $(source.itemSelector).each((_, el) => {
    const titleEl = $(el).find(source.titleSelector);
    let title = titleEl.text().trim();
    let link = titleEl.attr("href") || $(el).find(source.linkSelector).attr("href");
    
    if (!title) {
        const anyLink = $(el).find("a").first();
        title = anyLink.text().trim();
        link = link || anyLink.attr("href");
    }

    if (title && link) {
      const absLink = link.startsWith("http") ? link : new URL(link, source.baseUrl || source.url).toString();
      items.push(normalizeArticle({ title, link: absLink, source: source.name }));
    }
  });
  return items;
}

async function fetchDailyPharm(): Promise<Article[]> {
  const url = "https://www.dailypharm.com/Users/News/NewsList.html";
  const baseUrl = "https://www.dailypharm.com";
  const { data } = await axios.get(url, { 
    timeout: 10000, 
    headers: { 
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache"
    } 
  });
  const $ = cheerio.load(data);
  const items: Article[] = [];
  
  // Try specialized selectors first
  const selectors = [".art_list_all li", ".art_list li", ".art_list_box li"];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const artTit = $(el).find(".art_tit a, .tit a, a.tit").first();
      let title = artTit.text().trim();
      let link = artTit.attr("href");
      let dateTxt = $(el).find(".art_date, .date, span.date").text().trim();

      if (!title || !link) {
        const fallbackA = $(el).find('a[href*="NewsView"]').first();
        title = fallbackA.text().trim();
        link = fallbackA.attr("href");
      }

      if (title && link) {
        const absLink = link.startsWith("http") ? link : new URL(link, baseUrl).toString();
        items.push(normalizeArticle({ 
          title, 
          link: absLink, 
          source: "데일리팜",
          publishedAt: normalizeDate(dateTxt)
        }));
      }
    });
    if (items.length > 0) break;
  }
  return items;
}

async function fetchYakup(): Promise<Article[]> {
  const url = "https://www.yakup.com/news/index.html?mode=list";
  const baseUrl = "https://www.yakup.com";
  const { data } = await axios.get(url, { 
    timeout: 10000, 
    headers: { 
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache"
    } 
  });
  const $ = cheerio.load(data);
  const items: Article[] = [];

  const selectors = [".news-list > li", ".newsList li", ".news_list li"];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const titA = $(el).find(".tit a, .title a, a.tit, .tit, h2 a, h3 a").first();
      let title = titA.text().trim();
      let link = titA.attr("href") || $(el).find("a").first().attr("href");
      let dateTxt = $(el).find(".date, .time, .reg_date").text().trim();

      if (!title || !link) {
        const fallbackA = $(el).find('a[href*="/news/"]').first();
        title = fallbackA.text().trim();
        link = fallbackA.attr("href");
      }

      if (title && link) {
        const absLink = link.startsWith("http") ? link : new URL(link, baseUrl).toString();
        items.push(normalizeArticle({ 
          title, 
          link: absLink, 
          source: "약업신문",
          publishedAt: normalizeDate(dateTxt)
        }));
      }
    });
    if (items.length > 0) break;
  }
  return items;
}

async function fetchBusinessPost(): Promise<Article[]> {
  const url = "https://www.businesspost.co.kr/BP?command=article_list";
  const baseUrl = "https://www.businesspost.co.kr";
  
  const { data } = await axios.get(url, { 
    timeout: 10000, 
    headers: { 
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": "https://www.google.com/",
      "DNT": "1",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-User": "?1",
      "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Cache-Control": "no-cache"
    } 
  });
  const $ = cheerio.load(data);
  const items: Article[] = [];

  const selectors = [".list_area li", ".news_list_area li"];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const titA = $(el).find(".tit a, a.tit, .title a").first();
      let title = titA.text().trim();
      let link = titA.attr("href");
      let dateTxt = $(el).find(".date, .time").text().trim();

      if (title && link) {
        const absLink = link.startsWith("http") ? link : new URL(link, baseUrl).toString();
        items.push(normalizeArticle({ 
          title, 
          link: absLink, 
          source: "비즈니스포스트",
          publishedAt: normalizeDate(dateTxt)
        }));
      }
    });
    if (items.length > 0) break;
  }
  return items;
}

// RSS Auto-discovery helper
async function discoverRss(targetUrl: string): Promise<string | null> {
  try {
    const { data } = await axios.get(targetUrl, { timeout: 10000, headers: { "User-Agent": USER_AGENT } });
    const $ = cheerio.load(data);
    const linkRss = $("link[type='application/rss+xml']").attr("href") || $("link[type='application/atom+xml']").attr("href");
    if (linkRss) return linkRss.startsWith("http") ? linkRss : new URL(linkRss, targetUrl).toString();
    const commonPaths = ["/rss", "/rss/allArticle.xml", "/rss/all.xml", "/news/rss", "/rss/news.xml"];
    for (const path of commonPaths) {
      try {
        const testUrl = new URL(path, targetUrl).toString();
        const res = await axios.head(testUrl, { timeout: 5000 });
        const contentType = res.headers["content-type"];
        if (res.status === 200 && contentType && String(contentType).includes("xml")) return testUrl;
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

const normalizeDate = (value?: string | null): string | null => {
  if (!value) return null;
  
  let cleaned = value.replace(/입력|기사입력|등록|발행|승인|기사발행|Published|Created/g, "")
                .replace(/[\[\]\(\)]/g, " ")
                .replace(/\./g, "-")
                .replace(/\//g, "-")
                .replace(/년|월/g, "-")
                .replace(/일/g, " ")
                .replace(/\s+/g, " ")
                .trim();
                
  if (!cleaned) return null;
  
  const dateTimeMatch = cleaned.match(/(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?)/);
  if (dateTimeMatch) {
    const parsed = dayjs.tz(dateTimeMatch[1], "Asia/Seoul");
    if (parsed.isValid()) return parsed.toISOString();
  }

  const dateMatch = cleaned.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const parsed = dayjs.tz(dateMatch[1], "Asia/Seoul");
    if (parsed.isValid()) return parsed.toISOString();
  }

  try {
    const parsed = dayjs.tz(cleaned, "Asia/Seoul");
    if (parsed.isValid()) return parsed.toISOString();
  } catch (e) {}

  return null;
};

const normalizeLinkKey = (link: string) => {
  try {
    const url = new URL(link);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref", "source", "rss"].forEach(p => url.searchParams.delete(p));
    url.hash = "";
    return url.toString().replace(/\/$/, "").replace(/index\.html$/, "").toLowerCase();
  } catch {
    return link.split("#")[0].split("?")[0].replace(/\/$/, "").trim().toLowerCase();
  }
};

const normalizeTitleKey = (title: string) =>
  title.replace(/\[[^\]]*]/g, "").replace(/\([^)]*\)/g, "").replace(/[“”"'`.,:;|]/g, " ").replace(/\s+/g, "").trim().toLowerCase();

const normalizeArticle = (article: Partial<Article> & Pick<Article, "title" | "link" | "source">): Article => {
  const now = dayjs().toISOString();
  return {
    id: article.id || article.link,
    title: article.title.trim(),
    link: article.link,
    publishedAt: article.publishedAt || null,
    rssPublishedAt: article.rssPublishedAt || null,
    publishedAtSource: article.publishedAtSource || "not_found",
    fetchedAt: article.fetchedAt || now,
    source: article.source,
    content: article.content || "",
    isStarred: Boolean(article.isStarred),
    isRead: Boolean(article.isRead),
    aiAnalyzed: Boolean(article.aiAnalyzed),
    type: article.type || "etc",
    importance: article.importance || "mid",
    reason: article.reason || "",
    summary: article.summary || "",
    memo: article.memo || "",
    telegramSent: Boolean(article.telegramSent),
    entities: {
      companies: Array.isArray(article.entities?.companies) ? article.entities.companies : [],
      products: Array.isArray(article.entities?.products) ? article.entities.products : [],
    },
  };
};

async function fetchArticleContent(url: string) {
  try {
    const { data } = await axios.get(url, { timeout: 15000, headers: { "User-Agent": USER_AGENT } });
    const $ = cheerio.load(data);
    let extractedDate: string | null = null;
    let dateSource = "not_found";

    // 1. Body Text (Strong Priority patterns: Entered/Published)
    const bodyText = $("body").text();
    const strongDatePatterns = [
      /(?:입력|기사입력|등록|발행|기사발행)\s*[:]?\s*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/,
      /(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    ];

    for (const pattern of strongDatePatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1]) {
        // Validation: verify context is not "Modified" (수정)
        const matchIdx = match.index || 0;
        const context = bodyText.slice(Math.max(0, matchIdx - 20), matchIdx);
        if (!context.includes("수정") && !context.includes("Modified")) {
          extractedDate = match[1];
          dateSource = "body_text_strong";
          break;
        }
      }
    }

    // 2. JSON-LD datePublished
    if (!extractedDate) {
      $("script[type='application/ld+json']").each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || "{}");
          const d = json.datePublished;
          if (d) { extractedDate = d; dateSource = "ld_json"; return false; }
        } catch (e) {}
      });
    }

    // 3. article:published_time meta
    if (!extractedDate) {
      const meta = $("meta[property='article:published_time']").attr("content") ||
                   $("meta[property='og:published_time']").attr("content");
      if (meta) { extractedDate = meta; dateSource = "meta_article_time"; }
    }

    // 4. time element datetime
    if (!extractedDate) {
      const time = $("time[datetime]").attr("datetime");
      if (time) { extractedDate = time; dateSource = "time_tag"; }
    }

    // 5. Weak Selectors (Last resort)
    if (!extractedDate) {
      const weakSelectors = [".date", ".timestamp", ".reg-date", ".art_date", ".ar_time", ".reporting-date"];
      for (const s of weakSelectors) {
        const txt = $(s).first().text().trim();
        if (txt && /\d{4}/.test(txt)) {
          extractedDate = txt;
          dateSource = "weak_selector:" + s;
          break;
        }
      }
    }

    const content = [".article-body", ".view-content", "article", ".entry-content", "#newsContent", ".news_body", ".art_body", "#articleBody"]
      .map((s) => $(s).first().text().trim())
      .find((t) => t.length > 50);

    return { content: (content || "").replace(/\s+/g, " ").trim().slice(0, 5000), preciseDate: extractedDate, dateSource };
  } catch (error) {
    return { content: "", preciseDate: null, dateSource: "not_found" };
  }
}

async function analyzeArticleContent(article: Article) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await openai.chat.completions.create({
    model: modelName,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "한국 제약/바이오 전문가. JSON 반환." },
      { role: "user", content: `제목: ${article.title}\n본문: ${article.content.slice(0, 3000)}\n\nSchema: { "type": "...", "reason": "...", "summary": "...", "entities": { "companies": [], "products": [] } }` },
    ],
  });
  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  return {
    type: parsed.type || "etc",
    importance: "mid",
    reason: parsed.reason || "",
    summary: parsed.summary || "",
    entities: { companies: parsed.entities?.companies || [], products: parsed.entities?.products || [] },
    aiAnalyzed: true,
  } satisfies Partial<Article>;
}

async function fetchAndProcessNews() {
  const syncStats = { 
    startedAt: dayjs().toISOString(),
    finishedAt: "",
    durationMs: 0,
    totalSources: 0,
    successCount: 0,
    failCount: 0,
    totalFound: 0, 
    newArticles: 0, 
    sentTelegram: 0, 
    errors: [] as string[], 
    sources: {} as Record<string, SourceStatus> 
  };

  const tasks = [
    { name: "데일리팜", method: "dedicated" as const, fetchFn: fetchDailyPharm },
    { name: "약업신문", method: "dedicated" as const, fetchFn: fetchYakup },
    { name: "비즈니스포스트", method: "dedicated" as const, fetchFn: fetchBusinessPost },
    ...RSS_SOURCES.map(s => ({ name: s.name, method: "RSS" as const, fetchFn: () => fetchRssSource(s) })),
    ...WEB_SOURCES.map(s => ({ name: s.name, method: "web" as const, fetchFn: () => fetchWebSource(s) })),
  ];

  syncStats.totalSources = tasks.length;
  const startSync = Date.now();

  const results = await Promise.allSettled(tasks.map(async (task) => {
    const startedAt = dayjs().toISOString();
    const startTime = Date.now();
    try {
      // 10 second timeout per source
      const items = await withTimeout(task.fetchFn(), 10000, task.name);
      const durationMs = Date.now() - startTime;
      
      const status: SourceStatus = {
        source: task.name,
        method: task.method,
        startedAt,
        finishedAt: dayjs().toISOString(),
        durationMs,
        success: true,
        candidateCount: items.length,
        savedCount: 0,
      };

      if (items.length === 0 && task.method === "dedicated") {
        console.warn(`[Warning] ${task.name} 전용 scraper 후보 0건: selector 점검 필요`);
        status.error = "후보 0건: selector 점검 필요";
      }

      return { status, items };
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      const status: SourceStatus = {
        source: task.name,
        method: task.method,
        startedAt,
        finishedAt: dayjs().toISOString(),
        durationMs,
        success: false,
        candidateCount: 0,
        savedCount: 0,
        error: e.message,
        timeout: e.message.includes("Timeout"),
      };
      console.error(`[Sync Error] ${task.name}:`, e.message);
      return { status, items: [] as Article[] };
    }
  }));

  const allFound: Article[] = [];
  results.forEach((res) => {
    if (res.status === "fulfilled") {
        const { status, items } = res.value;
        syncStats.sources[status.source] = status;
        if (status.success) {
            syncStats.successCount++;
            allFound.push(...items);
        } else {
            syncStats.failCount++;
            syncStats.errors.push(`${status.source}: ${status.error}`);
        }
    }
  });

  syncStats.totalFound = allFound.length;
  const unique = allFound.filter((v, i, a) => a.findIndex(t => normalizeLinkKey(t.link) === normalizeLinkKey(v.link)) === i);
  
  const existingArticles = await bridge.getArticles();
  const existingLinks = new Set(existingArticles.map(a => normalizeLinkKey(a.link)));
  const notificationLog = await bridge.getNotifications();

  const toSave: Article[] = [];
  for (const art of unique) {
    const linkKey = normalizeLinkKey(art.link);
    if (!existingLinks.has(linkKey)) {
      const titleLower = art.title.toLowerCase();
      const hasIndustry = INDUSTRY_KEYWORDS.some(k => titleLower.includes(k.toLowerCase()));
      const hasEvent = EVENT_KEYWORDS.some(k => titleLower.includes(k.toLowerCase()));
      
      if (hasIndustry && hasEvent) {
        syncStats.newArticles++;
        if (syncStats.sources[art.source]) syncStats.sources[art.source].savedCount++;

        const fetched = await fetchArticleContent(art.link);
        art.content = fetched.content;
        if (fetched.preciseDate) { 
          art.publishedAt = normalizeDate(fetched.preciseDate); 
          art.publishedAtSource = fetched.dateSource; 
        } else if (!art.publishedAt) {
          art.publishedAt = null;
          art.publishedAtSource = "not_found";
        }
        
        const titleKey = normalizeTitleKey(art.title);
        const alreadySent = notificationLog.find((n: any) => normalizeTitleKey(n.normalizedTitle || "") === titleKey && n.source === art.source);
        
        if (!alreadySent) {
          try {
            await sendTelegramNotification(art);
            syncStats.sentTelegram++;
            art.telegramSent = true;
          } catch (e) {
             console.error("[Telegram Error]", e);
          }
        }
        toSave.push(art);
      }
    }
  }

  if (toSave.length > 0) {
    await bridge.syncArticles(toSave);
    console.log(`[Sync] Saved ${toSave.length} new articles.`);
  }
  
  syncStats.finishedAt = dayjs().toISOString();
  syncStats.durationMs = Date.now() - startSync;

  await bridge.updateRow("metadata", "key", "lastSync", syncStats);
  await bridge.updateRow("sync_logs", "timestamp", syncStats.startedAt, syncStats);
  return syncStats;
}

async function sendTelegramNotification(article: Article) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const msg = [`<b>${article.title}</b>`, "", `출처: ${article.source}`, `발행: ${article.publishedAt ? dayjs(article.publishedAt).tz("Asia/Seoul").format("MM-DD HH:mm") : "확인 불가"}`, "", article.link].join("\n");
  try {
    const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: msg, parse_mode: "HTML" });
    await bridge.updateRow("notifications", "normalizedLink", normalizeLinkKey(article.id), {
      normalizedLink: normalizeLinkKey(article.id),
      normalizedTitle: normalizeTitleKey(article.title),
      source: article.source,
      sentAt: dayjs().toISOString(),
      telegramMessageId: String(res.data.result.message_id)
    });
    return res.data;
  } catch (e) {}
}

async function startServer() {
  if (!process.env.GOOGLE_SCRIPT_URL || !process.env.GOOGLE_SCRIPT_SECRET) {
    console.warn("!!! 구글 시트 연동 설정이 필요합니다 !!!");
    console.warn("1. 우측 하단 Settings > Secrets 메뉴로 이동");
    console.warn("2. GOOGLE_SCRIPT_URL (배포된 웹 앱 URL) 추가");
    console.warn("3. GOOGLE_SCRIPT_SECRET (스크립트의 SECRET_TOKEN) 추가");
  }

  const app = express();
  app.use(express.json());

  app.get("/api/articles", async (_req, res) => {
    try {
      const data = await bridge.getArticles();
      const sorted = data.sort((a, b) => dayjs(b.fetchedAt).unix() - dayjs(a.fetchedAt).unix());
      res.json(sorted.slice(0, 500));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/metadata/sync", async (_req, res) => {
    try {
      const data = await bridge.getMetadata("lastSync");
      if (!data) {
        // Return a default structure if bridge fails to prevent frontend breakage
        return res.json({
          startedAt: "",
          finishedAt: "",
          totalSources: 0,
          successCount: 0,
          failCount: 0,
          newArticles: 0,
          sentTelegram: 0,
          sources: {}
        });
      }
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/sync", async (_req, res) => {
    try {
      const stats = await fetchAndProcessNews();
      res.json({ status: "ok", stats });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/revalidate-published-at", async (_req, res) => {
    try {
      const articles = await bridge.getArticles();
      let updatedCount = 0;
      
      // We'll process in small chunks or just selective to avoid huge delay
      // For now, let's try to process up to 100 most recent articles to avoid timeout
      const toProcess = articles.slice(0, 150);
      
      for (const art of toProcess) {
        const fetched = await fetchArticleContent(art.link);
        const newDate = normalizeDate(fetched.preciseDate);
        const newSource = fetched.preciseDate ? fetched.dateSource : "not_found";
        
        if (newDate !== art.publishedAt) {
          await bridge.updateRow("articles", "id", art.id, { 
            publishedAt: newDate, 
            publishedAtSource: newSource 
          });
          updatedCount++;
        }
      }
      res.json({ status: "ok", total: toProcess.length, updated: updatedCount });
    } catch (e: any) { 
      console.error("[Revalidate Error]", e);
      res.status(500).json({ error: e.message }); 
    }
  });

  app.post("/api/admin/migrate", async (_req, res) => {
    // Already in Sheet mode, so migration from JSON is usually done manually once or skipped
    res.json({ status: "ok", message: "Migration check completed.", count: 0 });
  });

  app.post("/api/articles/analysis", async (req, res) => {
    const { id } = req.body;
    try {
      const articles = await bridge.getArticles();
      const art = articles.find(a => a.id === id);
      if (!art) return res.status(404).json({ error: "Not found" });
      const result = await analyzeArticleContent(art);
      await bridge.updateRow("articles", "id", id, result);
      res.json({ ...art, ...result });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/star", async (req, res) => {
    try { await bridge.updateRow("articles", "id", req.body.id, { isStarred: req.body.isStarred }); res.json({ status: "ok" }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/read", async (req, res) => {
    try { await bridge.updateRow("articles", "id", req.body.id, { isRead: req.body.isRead }); res.json({ status: "ok" }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/memo", async (req, res) => {
    try { await bridge.updateRow("articles", "id", req.body.id, { memo: req.body.memo }); res.json({ status: "ok" }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/notify", async (req, res) => {
    try {
      const articles = await bridge.getArticles();
      const art = articles.find(a => a.id === req.body.id);
      if (!art) return res.status(404).send("Not found");
      await sendTelegramNotification(art);
      await bridge.updateRow("articles", "id", art.id, { telegramSent: true });
      res.json({ status: "ok" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/articles/clear", async (req, res) => {
    if (req.body.confirm !== "DELETE_ALL_ARTICLES") return res.status(400).send("Invalid");
    await bridge.clearAll();
    res.json({ status: "ok" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (_, res) => res.sendFile(path.join(process.cwd(), "dist/index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server on ${PORT}`));
}

startServer();
