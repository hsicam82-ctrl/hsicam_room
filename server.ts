import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import cron from "node-cron";
import OpenAI from "openai";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dotenv.config();

type Importance = "high" | "mid" | "low";
type ArticleType =
  | "approval"
  | "clinical"
  | "deal"
  | "earnings"
  | "pricing"
  | "legal"
  | "finance"
  | "product"
  | "etc";

interface Article {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
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

interface Source {
  name: string;
  url: string;
  baseUrl?: string;
}

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(process.cwd(), "articles.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const INDUSTRY_KEYWORDS = [
  "제약",
  "바이오",
  "신약",
  "의약품",
  "헬스케어",
  "임상",
  "품목허가",
  "식약처",
  "FDA",
  "기술이전",
  "라이선스",
  "CDMO",
  "허가",
  "승인",
  "치료제",
  "항암",
  "백신",
  "GMP",
];

const EVENT_KEYWORDS = [
  "실적",
  "매출",
  "영업이익",
  "임상",
  "임상시험",
  "허가",
  "승인",
  "NDA",
  "IND",
  "기술이전",
  "계약",
  "수주",
  "급여",
  "약가",
  "특허",
  "시판",
  "판매",
  "회수",
  "리콜",
  "투자",
  "IPO",
  "공급계약",
  "파트너십",
  "행정처분",
  "제조정지",
  "업무정지",
  "과징금",
  "인수",
  "합병",
  "소송",
  "무효",
  "침해",
  "출시",
];

const RSS_SOURCES: Source[] = [
  { name: "약사공론", url: "https://www.kpanews.co.kr/rss/allArticle.xml" },
  { name: "팜뉴스", url: "http://www.pharmnews.com/rss/allArticle.xml" },
  { name: "매일경제", url: "https://www.mk.co.kr/rss/30000023/" },
];

const WEB_SOURCES: Source[] = [
  { name: "데일리팜", url: "https://www.dailypharm.com/Users/News/NewsList.html", baseUrl: "https://www.dailypharm.com" },
  { name: "히트뉴스", url: "https://www.hitnews.co.kr/news/articleList.html?view_type=sm", baseUrl: "https://www.hitnews.co.kr" },
  { name: "더바이오", url: "https://www.thebionews.net/", baseUrl: "https://www.thebionews.net" },
  { name: "프레스나인", url: "https://www.press9.kr/news/articleList.html?view_type=sm", baseUrl: "https://www.press9.kr" },
  { name: "팜스투데이", url: "https://www.pharmstoday.com/news/articleList.html?view_type=sm", baseUrl: "https://www.pharmstoday.com" },
  { name: "헬스코리아뉴스", url: "https://www.hkn24.com/news/articleList.html", baseUrl: "https://www.hkn24.com" },
  { name: "청년의사", url: "https://www.docdocdoc.co.kr/news/articleList.html?sc_sub_section_code=S2N124", baseUrl: "https://www.docdocdoc.co.kr" },
  { name: "뉴스더보이스", url: "https://www.newsthevoice.com/news/articleList.html", baseUrl: "https://www.newsthevoice.com" },
  { name: "메디칼타임즈", url: "https://www.medicaltimes.com/Main/News/List.html?MainCate=3", baseUrl: "https://www.medicaltimes.com" },
  { name: "의학신문", url: "https://www.bosa.co.kr/news/articleList.html?view_type=sm", baseUrl: "https://www.bosa.co.kr" },
  { name: "한국경제", url: "https://www.hankyung.com/bioinsight", baseUrl: "https://www.hankyung.com" },
  { name: "서울경제", url: "https://www.sedaily.com/NewsList/GD05", baseUrl: "https://www.sedaily.com" },
  { name: "헬스조선", url: "https://health.chosun.com/list.html", baseUrl: "https://health.chosun.com" },
  { name: "메디팜뉴스", url: "http://www.medipharmnews.com/news/articleList.html?view_type=sm", baseUrl: "http://www.medipharmnews.com" },
  { name: "라포르시안", url: "https://www.rapportian.com/news/articleList.html?view_type=sm", baseUrl: "https://www.rapportian.com" },
  { name: "데일리메디", url: "https://www.dailymedi.com/news/news_list.php", baseUrl: "https://www.dailymedi.com" },
  { name: "바이오타임즈", url: "https://biotimes.co.kr/news/articleList.html?view_type=sm", baseUrl: "https://biotimes.co.kr" },
  { name: "메디게이트뉴스", url: "https://www.medigatenews.com/news/list", baseUrl: "https://www.medigatenews.com" },
  { name: "의약뉴스", url: "https://www.newsmp.com/news/articleList.html?view_type=sm", baseUrl: "https://www.newsmp.com" },
  { name: "메디소비자뉴스", url: "https://www.medisobizanews.com/news/articleList.html?view_type=sm", baseUrl: "https://www.medisobizanews.com" },
  { name: "약업신문", url: "https://www.yakup.com/news/index.html?mode=list", baseUrl: "https://www.yakup.com" },
  { name: "메디파나뉴스", url: "https://www.medipana.com/news/articleList.html?view_type=sm", baseUrl: "https://www.medipana.com" },
  { name: "바이오스펙테이터", url: "http://www.biospectator.com/section/section_list.php?code=1100", baseUrl: "http://www.biospectator.com" },
  { name: "이데일리팜", url: "http://pharm.edaily.co.kr/News/NewsList", baseUrl: "http://pharm.edaily.co.kr" },
  { name: "매경헬스", url: "https://www.mkhealth.co.kr/news/articleList.html?view_type=sm", baseUrl: "https://www.mkhealth.co.kr" },
];

const parser = new Parser({
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  timeout: 10000,
});

let syncInFlight: Promise<Article[]> | null = null;

const normalizeDate = (value?: string | null): string => {
  if (!value) return dayjs().toISOString();

  const cleaned = value
    .replace(/입력|수정|발행|등록|승인|기사입력/g, "")
    .replace(/[\[\]\(\)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return dayjs().toISOString();

  const candidates = [
    cleaned,
    cleaned.replace(/\./g, "-"),
    cleaned.replace(/(\d{2})-(\d{2})-(\d{2})/, "20$1-$2-$3"),
  ];

  for (const candidate of candidates) {
    const parsed = dayjs.tz(candidate, "Asia/Seoul");
    if (parsed.isValid()) return parsed.toISOString();
  }

  const fallback = dayjs(cleaned);
  return fallback.isValid() ? fallback.toISOString() : dayjs().toISOString();
};

const toAbsoluteUrl = (link: string, source: Source): string => {
  if (link.startsWith("http")) return link;
  return new URL(link, source.baseUrl || source.url).toString();
};

const normalizeLinkKey = (link: string) => {
  try {
    const url = new URL(link);
    const paramsToDrop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
    ];
    paramsToDrop.forEach((param) => url.searchParams.delete(param));
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return link.split("#")[0].replace(/\/$/, "").trim().toLowerCase();
  }
};

const normalizeTitleKey = (title: string) =>
  title
    .replace(/\[[^\]]*]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[“”"'`.,:;|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const getArticleDedupKey = (article: Pick<Article, "link" | "title" | "source">) =>
  `${normalizeLinkKey(article.link)}|${article.source}|${normalizeTitleKey(article.title)}`;

const getNotificationDedupKey = (article: Pick<Article, "link" | "title" | "source">) =>
  `${normalizeLinkKey(article.link)}|${normalizeTitleKey(article.title)}`;

const normalizeArticle = (article: Partial<Article> & Pick<Article, "title" | "link" | "source">): Article => {
  const id = article.id || article.link;
  const now = dayjs().toISOString();

  return {
    id,
    title: article.title.trim(),
    link: article.link,
    publishedAt: article.publishedAt || article.fetchedAt || now,
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

const loadArticles = (): Article[] => {
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    if (!Array.isArray(data)) return [];
    return data
      .filter((article) => article?.title && article?.link && article?.source)
      .map((article) =>
        normalizeArticle({
          ...article,
          publishedAt: article.publishedAt || article.date || null,
          fetchedAt: article.fetchedAt || article.date || dayjs().toISOString(),
        }),
      );
  } catch (error) {
    console.error("[DB] Load failed:", error);
    return [];
  }
};

const saveArticles = (articles: Article[]) => {
  try {
    const normalized = articles
      .map(normalizeArticle)
      .sort((a, b) => new Date(b.publishedAt || b.fetchedAt).getTime() - new Date(a.publishedAt || a.fetchedAt).getTime())
      .slice(0, 1000);
    const tmpPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), "utf-8");
    fs.renameSync(tmpPath, DB_PATH);
  } catch (error) {
    console.error("[DB] Save failed:", error);
  }
};

async function fetchArticleContent(url: string) {
  try {
    const { data } = await axios.get(url, {
      timeout: 9000,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    const $ = cheerio.load(data);
    const preciseDate =
      $("meta[property='article:published_time']").attr("content") ||
      $("meta[name='pubdate']").attr("content") ||
      $(".info-text, .article-info, .byline, .date, .published-at, .entry-date, .time, .reg-date")
        .first()
        .text()
        .trim() ||
      null;

    const content = [
      "#article-view",
      "#news_content",
      ".article-body",
      ".view-content",
      ".news-view-content",
      ".article_view",
      ".at-content",
      "article",
    ]
      .map((selector) => $(selector).first().text().trim())
      .find((text) => text.length > 80);

    return {
      content: (content || "").replace(/\s+/g, " ").trim().slice(0, 5000),
      preciseDate,
    };
  } catch (error: any) {
    console.error(`[Scraper] Article fetch failed for ${url}: ${error.message}`);
    return { content: "", preciseDate: null };
  }
}

async function analyzeArticleContent(article: Article) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다. .env 파일을 확인해주세요.");
  }

  let contentToAnalyze = article.content;
  const articlePatch: Partial<Article> = {};

  if (contentToAnalyze.length < 80) {
    const fetched = await fetchArticleContent(article.link);
    if (fetched.content) {
      contentToAnalyze = fetched.content;
      articlePatch.content = fetched.content;
    }
    if (fetched.preciseDate) {
      articlePatch.publishedAt = normalizeDate(fetched.preciseDate);
    }
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "당신은 한국 제약/바이오 산업 전문 에디터입니다. 기사를 실무자가 빠르게 판단할 수 있게 분류하고 요약합니다. 반드시 JSON만 반환합니다.",
      },
      {
        role: "user",
        content: [
          `제목: ${article.title}`,
          `출처: ${article.source}`,
          `본문: ${contentToAnalyze.slice(0, 3500) || "(본문 없음)"}`,
          "",
          "다음 JSON 스키마로 답하세요.",
          '{ "type": "approval|clinical|deal|earnings|pricing|legal|finance|product|etc", "importance": "high|mid|low", "reason": "중요도 판단 근거 한 문장", "summary": "핵심 요약 3~5줄", "entities": { "companies": ["회사명"], "products": ["제품명"] } }',
        ].join("\n"),
      },
    ],
  });

  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  const validTypes: ArticleType[] = ["approval", "clinical", "deal", "earnings", "pricing", "legal", "finance", "product", "etc"];
  const validImportance: Importance[] = ["high", "mid", "low"];

  return {
    ...articlePatch,
    type: validTypes.includes(parsed.type) ? parsed.type : "etc",
    importance: validImportance.includes(parsed.importance) ? parsed.importance : "mid",
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : parsed.summary && typeof parsed.summary === "object"
          ? Object.values(parsed.summary).join("\n")
          : "",
    entities: {
      companies: Array.isArray(parsed.entities?.companies) ? parsed.entities.companies.filter(Boolean).map(String) : [],
      products: Array.isArray(parsed.entities?.products) ? parsed.entities.products.filter(Boolean).map(String) : [],
    },
    aiAnalyzed: true,
  } satisfies Partial<Article>;
}

async function scrapeWebSource(source: Source) {
  try {
    const { data } = await axios.get(source.url, {
      timeout: source.name === "데일리메디" ? 15000 : 10000,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: source.baseUrl || source.url,
      },
    });

    const $ = cheerio.load(data);
    const items: Partial<Article>[] = [];

    const pushItem = (title?: string, link?: string, date?: string, content?: string) => {
      const cleanTitle = (title || "").replace(/\s+/g, " ").trim();
      if (!cleanTitle || !link || cleanTitle.length < 5) return;
      const absoluteLink = toAbsoluteUrl(link, source);
      items.push({
        id: absoluteLink,
        title: cleanTitle,
        link: absoluteLink,
        source: source.name,
        publishedAt: normalizeDate(date),
        fetchedAt: dayjs().toISOString(),
        content: content || "",
      });
    };

    if (source.name === "데일리팜") {
      $(".art_list_all li").each((_, el) => {
        pushItem($(el).find(".art_tit").text(), $(el).find("a").attr("href"), $(el).find(".art_date").text());
      });
    } else if (source.name === "약업신문") {
      $(".news-list > li, .newsList li").each((_, el) => {
        pushItem($(el).find(".tit, .title, a").first().text(), $(el).find("a").attr("href"), $(el).find(".date").text());
      });
    } else {
      const selectors = [
        ".list-titles a",
        ".titles a",
        ".title a",
        ".art-title a",
        ".item-title a",
        "#article-list a.title",
        ".news-list a",
        ".list-item a",
        ".type-2 a",
        "h4 a",
        ".newsList a",
        ".list_title a",
        "a[href*='article']",
        "a[href*='news']",
      ].join(", ");

      $(selectors).each((_, el) => {
        const link = $(el).attr("href");
        const bucket = $(el).closest("li, article, div");
        const date = bucket.find(".date, .time, .dated, .reg-date, .byline").first().text();
        const snippet = bucket.find(".lead, .summary, .desc, p").first().text();
        pushItem($(el).text(), link, date, snippet);
      });
    }

    const seen = new Set<string>();
    return items
      .filter((item) => {
        if (!item.link || seen.has(item.link)) return false;
        seen.add(item.link);
        return true;
      })
      .slice(0, 15)
      .map((item) => normalizeArticle(item as Article));
  } catch (error: any) {
    console.error(`[Scraper] ${source.name} failed: ${error.message}`);
    return [];
  }
}

const isRelevantArticle = (article: Article) => {
  const text = `${article.title} ${article.content}`.toLowerCase();
  const hasIndustry = INDUSTRY_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasEvent = EVENT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  return hasIndustry && hasEvent;
};

async function fetchAndProcessNews() {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    console.log("[Fetcher] News sync started.");
    const allArticles: Article[] = [];

    for (const source of RSS_SOURCES) {
      try {
        const feed = await parser.parseURL(source.url);
        feed.items?.forEach((item) => {
          if (!item.title || !item.link) return;
          allArticles.push(
            normalizeArticle({
              id: item.guid || item.link,
              title: item.title,
              link: item.link,
              publishedAt: normalizeDate(item.isoDate || item.pubDate),
              fetchedAt: dayjs().toISOString(),
              source: source.name,
              content: item.contentSnippet || item.content || "",
            }),
          );
        });
      } catch (error: any) {
        console.error(`[Fetcher] RSS ${source.name} failed: ${error.message}`);
      }
    }

    const webResults = await Promise.allSettled(WEB_SOURCES.map((source) => scrapeWebSource(source)));
    webResults.forEach((result) => {
      if (result.status === "fulfilled") allArticles.push(...result.value);
    });

    const existingArticles = loadArticles();
    const existingIds = new Set(existingArticles.map((article) => article.id));
    const existingArticleKeys = new Set(existingArticles.map(getArticleDedupKey));
    const sentNotificationKeys = new Set(
      existingArticles.filter((article) => article.telegramSent).map(getNotificationDedupKey),
    );
    const newArticles = allArticles.filter(
      (article) => !existingIds.has(article.id) && !existingArticleKeys.has(getArticleDedupKey(article)) && isRelevantArticle(article),
    );
    const uniqueNewArticles = newArticles.filter(
      (article, index, list) =>
        list.findIndex(
          (target) =>
            getArticleDedupKey(target) === getArticleDedupKey(article) ||
            getNotificationDedupKey(target) === getNotificationDedupKey(article),
        ) === index,
    );

    if (uniqueNewArticles.length > 0) {
      for (let i = 0; i < uniqueNewArticles.length; i += 5) {
        const batch = uniqueNewArticles.slice(i, i + 5);
        await Promise.allSettled(
          batch.map(async (article) => {
            const fetched = await fetchArticleContent(article.link);
            if (fetched.content) article.content = fetched.content;
            if (fetched.preciseDate) article.publishedAt = normalizeDate(fetched.preciseDate);
          }),
        );
      }

      for (const article of uniqueNewArticles) {
        const notificationKey = getNotificationDedupKey(article);
        if (sentNotificationKeys.has(notificationKey)) {
          article.telegramSent = true;
          console.log(`[Telegram] Skipped duplicate notification: ${article.title}`);
          continue;
        }

        try {
          await sendTelegramNotification(article);
          article.telegramSent = true;
          sentNotificationKeys.add(notificationKey);
        } catch (error: any) {
          article.telegramSent = false;
          console.error(`[Telegram] Auto notification failed for ${article.id}: ${error.message || error}`);
        }
      }
    }

    const finalArticles = [...uniqueNewArticles, ...existingArticles];
    saveArticles(finalArticles);
    console.log(`[Fetcher] News sync finished. New articles: ${uniqueNewArticles.length}`);
    return uniqueNewArticles;
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function sendTelegramNotification(article: Article, isTest = false) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 설정되어 있지 않습니다.");
  }

  const message = isTest
    ? `<b>[BioTicker 테스트]</b>\n\n텔레그램 연결이 정상입니다.\n시간: ${dayjs().tz("Asia/Seoul").format("YYYY-MM-DD HH:mm:ss")}`
    : [
        `<b>[${article.importance.toUpperCase()}] ${article.title}</b>`,
        "",
        `출처: ${article.source}`,
        `발행: ${article.publishedAt ? dayjs(article.publishedAt).tz("Asia/Seoul").format("YYYY-MM-DD HH:mm:ss") : "확인 불가"}`,
        `분류: ${article.type}`,
        "",
        article.summary ? `<b>요약</b>\n${article.summary}` : article.reason ? `<b>판단 근거</b>\n${article.reason}` : "아직 AI 분석 요약이 없습니다.",
        "",
        article.link,
      ].join("\n");

  const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });

  return response.data;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  cron.schedule("*/5 * * * *", () => {
    console.log(`[Cron] ${dayjs().tz("Asia/Seoul").format("YYYY-MM-DD HH:mm:ss")} sync triggered.`);
    fetchAndProcessNews().catch((error) => console.error("[Cron] Sync failed:", error));
  });

  if (loadArticles().length === 0) {
    fetchAndProcessNews().catch((error) => console.error("[Startup] Initial sync failed:", error));
  }

  app.get("/api/articles", (_req, res) => {
    res.json(loadArticles());
  });

  app.post("/api/articles/sync", async (_req, res) => {
    try {
      const newArticles = await fetchAndProcessNews();
      res.json({ status: "ok", newCount: newArticles.length, data: loadArticles() });
    } catch (error: any) {
      res.status(500).json({ status: "error", error: error.message || "뉴스 수집 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/articles/star", (req, res) => {
    const { id, isStarred } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex((article) => article.id === id);
    if (index === -1) return res.status(404).json({ error: "기사를 찾을 수 없습니다.", receivedId: id });
    articles[index].isStarred = Boolean(isStarred);
    saveArticles(articles);
    res.json(articles[index]);
  });

  app.post("/api/articles/read", (req, res) => {
    const { id, isRead } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex((article) => article.id === id);
    if (index === -1) return res.status(404).json({ error: "기사를 찾을 수 없습니다.", receivedId: id });
    articles[index].isRead = Boolean(isRead);
    saveArticles(articles);
    res.json(articles[index]);
  });

  app.post("/api/articles/memo", (req, res) => {
    const { id, memo } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex((article) => article.id === id);
    if (index === -1) return res.status(404).json({ error: "기사를 찾을 수 없습니다.", receivedId: id });
    articles[index].memo = String(memo || "");
    saveArticles(articles);
    res.json(articles[index]);
  });

  app.post("/api/articles/analysis", async (req, res) => {
    const { id } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex((article) => article.id === id);
    if (index === -1) return res.status(404).json({ error: "기사를 찾을 수 없습니다.", receivedId: id });

    try {
      const aiResult = await analyzeArticleContent(articles[index]);
      articles[index] = normalizeArticle({ ...articles[index], ...aiResult });
      saveArticles(articles);
      res.json(articles[index]);
    } catch (error: any) {
      console.error("[AI] Manual analysis failed:", error);
      res.status(500).json({ error: error.message || "AI 분석 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/articles/notify", async (req, res) => {
    const { id } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex((article) => article.id === id);
    if (index === -1) return res.status(404).json({ error: "기사를 찾을 수 없습니다.", receivedId: id });

    try {
      await sendTelegramNotification(articles[index]);
      articles[index].telegramSent = true;
      saveArticles(articles);
      res.json(articles[index]);
    } catch (error: any) {
      console.error("[Telegram] Manual notification failed:", error);
      res.status(500).json({ error: error.message || "텔레그램 전송 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/telegram/test", async (_req, res) => {
    try {
      await sendTelegramNotification(loadArticles()[0] || normalizeArticle({ title: "테스트", link: "https://example.com", source: "BioTicker" }), true);
      res.json({ status: "ok" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "텔레그램 테스트 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/articles/clear", (req, res) => {
    if (req.body?.confirm !== "DELETE_ALL_ARTICLES") {
      return res.status(400).json({ error: "삭제 확인 문구가 올바르지 않습니다." });
    }
    saveArticles([]);
    res.json({ message: "cleared" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: dayjs().toISOString() });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BioTicker server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("[Server] Failed to start:", error);
  process.exit(1);
});
