import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import OpenAI from "openai";
import dotenv from "dotenv";
import Parser from "rss-parser";
import axios from "axios";
import cron from "node-cron";
import fs from "fs";

import * as cheerio from "cheerio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

dotenv.config();

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  },
  timeout: 10000
});
const DB_PATH = path.join(process.cwd(), "articles.json");

// --- Source Configuration ---
const INDUSTRY_KEYWORDS = [
  '제약', '바이오', '신약', '의약품', '제약사', '바이오기업', '임상', '품목허가', '식약처', 'FDA', '기술이전', '라이선스', 'CDMO',
  '허가', '승인', '품목', '치료제', '항암', '백신', 'GMP'
];

const EVENT_KEYWORDS = [
  '실적', '매출', '영업이익', '임상', '임상시험', '허가', '승인', 'NDA', 'IND', '기술이전', '계약', '수주', '급여', '약가', '특허', 
  '제네릭', '판매정지', '회수', '리콜', '투자', 'IPO', '공급계약', '파트너십', '행정처분', '제조정지', '업무정지', '과징금', '점검', 
  '실사', '위반', '허가취소', '특허분쟁', '특허 소송', '무효', '무효심판', '침해', '회피', '소송', '판결', '가처분', '권리범위'
];

const RSS_SOURCES = [
  { name: '약사공론', url: 'https://www.kpanews.co.kr/rss/allArticle.xml' },
  { name: '팜뉴스', url: 'http://www.pharmnews.com/rss/allArticle.xml' },
  { name: '매일경제', url: 'https://www.mk.co.kr/rss/30000023/' }
];

const WEB_SOURCES = [
  { name: '데일리팜', url: 'https://www.dailypharm.com/Users/News/NewsList.html', baseUrl: 'https://www.dailypharm.com' },
  { name: '히트뉴스', url: 'https://www.hitnews.co.kr/news/articleList.html?view_type=sm', baseUrl: 'https://www.hitnews.co.kr' },
  { name: '더바이오', url: 'https://www.thebionews.net/', baseUrl: 'https://www.thebionews.net' },
  { name: '프레스9', url: 'https://www.press9.kr/news/articleList.html?view_type=sm', baseUrl: 'https://www.press9.kr' },
  { name: '메디팜스투데이', url: 'https://www.pharmstoday.com/news/articleList.html?view_type=sm', baseUrl: 'https://www.pharmstoday.com' },
  { name: '헬스코리아뉴스', url: 'https://www.hkn24.com/news/articleList.html', baseUrl: 'https://www.hkn24.com' },
  { name: '청년의사', url: 'https://www.docdocdoc.co.kr/news/articleList.html?sc_sub_section_code=S2N124', baseUrl: 'https://www.docdocdoc.co.kr' },
  { name: '뉴스더보이스', url: 'https://www.newsthevoice.com/news/articleList.html', baseUrl: 'https://www.newsthevoice.com' },
  { name: '메디칼타임즈', url: 'https://www.medicaltimes.com/Main/News/List.html?MainCate=3', baseUrl: 'https://www.medicaltimes.com' },
  { name: '의학신문', url: 'https://www.bosa.co.kr/news/articleList.html?view_type=sm', baseUrl: 'https://www.bosa.co.kr' },
  { name: '한국경제', url: 'https://www.hankyung.com/bioinsight', baseUrl: 'https://www.hankyung.com' },
  { name: '서울경제', url: 'https://www.sedaily.com/NewsList/GD05', baseUrl: 'https://www.sedaily.com' },
  { name: '조선헬스', url: 'https://health.chosun.com/list.html', baseUrl: 'https://health.chosun.com' },
  { name: '메디팜뉴스', url: 'http://www.medipharmnews.com/news/articleList.html?view_type=sm', baseUrl: 'http://www.medipharmnews.com' },
  { name: '라포르시안', url: 'https://www.rapportian.com/news/articleList.html?view_type=sm', baseUrl: 'https://www.rapportian.com' },
  { name: '데일리메디', url: 'https://www.dailymedi.com/news/news_list.php', baseUrl: 'https://www.dailymedi.com' },
  { name: '바이오타임즈', url: 'https://biotimes.co.kr/news/articleList.html?view_type=sm', baseUrl: 'https://biotimes.co.kr' },
  { name: '메디게이트뉴스', url: 'https://www.medigatenews.com/news/list', baseUrl: 'https://www.medigatenews.com' },
  { name: '의약뉴스', url: 'https://www.newsmp.com/news/articleList.html?view_type=sm', baseUrl: 'https://www.newsmp.com' },
  { name: '메디소비자뉴스', url: 'https://www.medisobizanews.com/news/articleList.html?view_type=sm', baseUrl: 'https://www.medisobizanews.com' },
  { name: '약업신문', url: 'https://www.yakup.com/news/index.html?mode=list', baseUrl: 'https://www.yakup.com' },
  { name: '메디파나뉴스', url: 'https://www.medipana.com/news/articleList.html?view_type=sm', baseUrl: 'http://www.medipana.com' },
  { name: '바이오스펙테이터', url: 'http://www.biospectator.com/section/section_list.php?code=1100', baseUrl: 'http://www.biospectator.com' },
  { name: '팜이데일리', url: 'http://pharm.edaily.co.kr/News/NewsList', baseUrl: 'http://pharm.edaily.co.kr' },
  { name: '매경헬스', url: 'https://www.mkhealth.co.kr/news/articleList.html?view_type=sm', baseUrl: 'https://www.mkhealth.co.kr' }
];

// Helper to normalize dates to ISO UTC while assuming Asia/Seoul for local strings
const normalizeDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return dayjs().toISOString();
  
  const cleanStr = dateStr.trim()
    .replace(/[\[\]\(\)]/g, '')
    .replace(/입력/g, '')
    .replace(/발행/g, '')
    .replace(/수정/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanStr) return dayjs().toISOString();

  try {
    let d;
    if (/^\d+$/.test(cleanStr)) {
      d = dayjs(parseInt(cleanStr));
    } else {
      // Handle "2024.05.07 06:00" or "24.05.07 06:00"
      const dotPattern = cleanStr.replace(/\./g, '-');
      d = dayjs.tz(dotPattern, 'Asia/Seoul');
      
      // If it only has the date "2024-05-07", dayjs.tz will set time to 00:00.
      // If the string length is short (e.g., YY-MM-DD), it might need help
      if (!d.isValid()) {
         d = dayjs(cleanStr);
      }
    }
    return d.isValid() ? d.toISOString() : dayjs().toISOString();
  } catch (e) {
    return dayjs().toISOString();
  }
};

// Helper to load/save articles
const loadArticles = (): any[] => {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      // Migration: Ensure new fields exist
      let migrated = false;
      const updated = data.map((a: any) => {
        if (!a.fetchedAt && a.date) {
          a.fetchedAt = a.date;
          if (!a.publishedAt) a.publishedAt = a.date;
          migrated = true;
        }
        return a;
      });
      if (migrated) {
        saveArticles(updated);
      }
      return updated;
    }
  } catch (e) {
    console.error("DB Load Error", e);
  }
  return [];
};

const saveArticles = (articles: any[]) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(articles.slice(0, 500), null, 2));
  } catch (e) {
    console.error("DB Save Error", e);
  }
};

// Helper to send Telegram message
async function sendTelegramNotification(article: any, isTest = false) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    const errorPrefix = "[Telegram] Config missing";
    console.log(`${errorPrefix}, skipping notification.`);
    if (isTest) throw new Error(`${errorPrefix}. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.`);
    return;
  }

  let message = '';
  if (isTest) {
    message = `🧪 <b>[Telegram 알림 테스트]</b>\n\n` +
              `✅ 시스템이 정상적으로 작동하고 있습니다.\n` +
              `⏰ 테스트 시간: ${dayjs().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')}\n` +
              `🎯 대상: ${chatId}`;
  } else {
    const importanceLabel = article.importance === 'high' ? '🚨 [긴급/High]' : '🔔 [중요/Mid]';
    const fetchedTime = article.fetchedAt ? dayjs(article.fetchedAt).tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss') : '-';
    const publishedTime = article.publishedAt ? dayjs(article.publishedAt).tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss') : '발행 시간 확인 불가';

    message = `${importanceLabel} ${article.title}\n\n` +
              `📍 매체명: ${article.source}\n` +
              `⏰ 발행: ${publishedTime}\n` +
              `📥 수집: ${fetchedTime}\n\n` +
              `💡 요약:\n${article.summary || article.reason || '요약 정보 없음'}\n\n` +
              `🔗 원문 링크:\n${article.link}`;
  }

  try {
    const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
    console.log(`[Telegram] Sent ${isTest ? 'test message' : 'notification for: ' + article.id}`);
    return { status: response.status, data: response.data };
  } catch (e: any) {
    const errorData = e.response?.data || { error: e.message };
    const statusCode = e.response?.status || 500;
    console.error(`[Telegram] Error sending message (${statusCode}):`, errorData);
    throw { statusCode, errorData };
  }
}

async function fetchArticleContent(url: string) {
  try {
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    
    // Exact date extraction for various CMS
    const preciseDateStr = 
      $('.info-text li:contains("입력"), .info-text:contains("입력"), .info-text').first().text().trim() ||
      $('.byline em:contains("202"), .byline li:contains("202")').first().text().trim() ||
      $('.article-head-info .date, .article-info .info-text').text().trim() ||
      $('.date, .published-at, .entry-date, .time, .dated, .reg-date').first().text().trim() ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="pubdate"]').attr('content') ||
      "";

    // Common selectors for news content
    const content = $('#article-view').text() || $('#news_content').text() || $('.article-body').text() || $('.view-content').text() || $('.news-view-content').text() || $('.at-content').text() || "";
    
    return {
      content: content.trim().slice(0, 3000),
      preciseDate: preciseDateStr || null
    };
  } catch (e) {
    console.error(`[Scraper] Full content fetch failed for ${url}:`, e);
    return { content: "", preciseDate: null };
  }
}

async function analyzeArticleContent(article: any) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("[AI] OPENAI_API_KEY is not set.");
    throw new Error("OpenAI API 키가 설정되지 않았습니다. .env 파일이나 설정을 확인해주세요.");
  }
  
  try {
    // If content is missing, try to fetch it first
    let contentToAnalyze = article.content || "";
    if (contentToAnalyze.length < 50) {
      console.log(`[AI] Content too short, fetching full content for: ${article.title}`);
      const { content: fetchedContent, preciseDate } = await fetchArticleContent(article.link);
      if (fetchedContent) {
        contentToAnalyze = fetchedContent;
      }
      if (preciseDate && (!article.publishedAt || article.publishedAt.includes('00:00:00'))) {
        article.publishedAt = normalizeDate(preciseDate);
      }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `제약바이오 전문 분석가로서 다음 기사를 분석하세요:
    제목: ${article.title}
    본문: ${contentToAnalyze.slice(0, 1500)}
    
    결과는 다음 JSON 형식으로만 응답하세요. "summary"는 반드시 하나의 문자열이어야 합니다:
    {
      "type": "approval/clinical/deal/earnings/pricing/legal/finance/product/etc 중 하나",
      "importance": "high/mid/low 중 하나",
      "reason": "중요도 선정 이유",
      "summary": "핵심 내용을 상세히 5줄로 요약한 단일 문자열 (번호 매김 포함)",
      "entities": { "companies": ["회사명"], "products": ["제품명"] }
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const aiData = JSON.parse(response.choices[0].message.content || "{}");
    
    // Safety check: Ensure summary is a string
    if (aiData.summary && typeof aiData.summary === 'object') {
      aiData.summary = Object.values(aiData.summary).join('\n');
    }

    // Safety check: Ensure entities are arrays
    if (aiData.entities) {
      if (aiData.entities.companies && !Array.isArray(aiData.entities.companies)) {
        aiData.entities.companies = typeof aiData.entities.companies === 'object' ? Object.values(aiData.entities.companies) : [];
      }
      if (aiData.entities.products && !Array.isArray(aiData.entities.products)) {
        aiData.entities.products = typeof aiData.entities.products === 'object' ? Object.values(aiData.entities.products) : [];
      }
    } else {
      aiData.entities = { companies: [], products: [] };
    }

    return aiData;
  } catch (e) {
    console.error(`[AI] Analysis failed for ${article.id}:`, e);
    return null;
  }
}

async function scrapeWebSource(source: typeof WEB_SOURCES[0]) {
  try {
    const isDailyMedi = source.name === '데일리메디';
    const { data } = await axios.get(source.url, {
      timeout: isDailyMedi ? 15000 : 10000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': source.baseUrl
      }
    });

    const $ = cheerio.load(data);
    const items: any[] = [];
    const now = dayjs().tz('Asia/Seoul');

    // Site-specific logic for high accuracy
    if (source.name === '데일리메디') {
      $('.art_list_all li').each((_, el) => {
        const title = $(el).find('.art_tit').text().trim();
        const link = $(el).find('a').attr('href');
        const dateStr = $(el).find('.art_date').text().trim(); // "24-05-07 07:11"
        if (title && link) {
          items.push({ title, link: link.startsWith('http') ? link : `${source.baseUrl}${link}`, isoDate: normalizeDate(dateStr), contentSnippet: "" });
        }
      });
    } else if (source.name === '약업신문') {
      $('.news-list > li').each((_, el) => {
        const title = $(el).find('.tit').text().trim();
        const link = $(el).find('a').attr('href');
        const dateStr = $(el).find('.date').text().trim();
        if (title && link) {
          items.push({ title, link: link.startsWith('http') ? link : `${source.baseUrl}${link.startsWith('/') ? '' : '/'}${link}`, isoDate: normalizeDate(dateStr), contentSnippet: "" });
        }
      });
    } else if (source.name === '청년의사' || source.name === '메디파나뉴스') {
      $('.article-list-content .list-item').each((_, el) => {
        const title = $(el).find('.list-titles').text().trim();
        const link = $(el).find('a').attr('href');
        const dateStr = $(el).find('.list-dated, .byline').text().trim() || $(el).find('.byline li').last().text().trim();
        if (title && link) {
          items.push({ title, link: link.startsWith('http') ? link : `${source.baseUrl}${link}`, isoDate: normalizeDate(dateStr), contentSnippet: "" });
        }
      });
    } else if (source.name === '라포르시안' || source.name === '히트뉴스' || source.name === '뉴스더보이스' || source.name === '의학신문') {
      $('.article-list-content .list-item, .item, li').each((_, el) => {
        const title = $(el).find('.list-titles, .tit, .title, a').first().text().trim();
        const link = $(el).find('a').attr('href');
        const dateStr = $(el).find('.list-dated, .date, .dated, .reg-date, .byline').text().trim();
        if (title.length > 5 && link) {
          items.push({ title, link: link.startsWith('http') ? link : `${source.baseUrl}${link}`, isoDate: normalizeDate(dateStr), contentSnippet: "" });
        }
      });
    } else {
      // General fall-back pattern
      const selectors = [
        '.list-titles em a', '.list-titles a', '.titles a', '.title a',
        '.art-title a', '.list-table .list-titles a', '.item-title a',
        '#article-list a.title', '.news-list a', '.list-item a', '.type-2 a',
        'h4 a', '.newsList a', '.list_title a'
      ].join(', ');

      $(selectors).each((_, el) => {
        const title = $(el).text().trim();
        let link = $(el).attr('href');
        
        if (title && link && title.length > 5) {
          if (!link.startsWith('http')) {
            link = source.baseUrl + (link.startsWith('/') ? '' : '/') + link;
          }
          
          // Try to find a date sibling in the same bucket
          let dateStr = $(el).parent().find('.date, .time, .dated, .reg-date, .byline').text().trim() || 
                        $(el).closest('li, div').find('.date, .time, .dated, .reg-date, .byline').text().trim();

          if (link.includes('article') || link.includes('news') || link.includes('view') || link.includes('Article') || link.includes('Read') || link.includes('List')) {
            items.push({
              title,
              link,
              isoDate: normalizeDate(dateStr),
              contentSnippet: ""
            });
          }
        }
      });
    }

    return items.slice(0, 15);
  } catch (e: any) {
    console.error(`[Scraper] ${source.name} failed: ${e.message}`);
    return [];
  }
}

async function fetchAndProcessNews() {
  console.log("[Fetcher] Starting comprehensive news sync process...");
  
  const allArticles: any[] = [];
  
  // 1. Fetch RSS Sources
  for (const source of RSS_SOURCES) {
    try {
      console.log(`[Fetcher] Requesting RSS: ${source.name}`);
      const feed = await parser.parseURL(source.url);
      feed.items?.forEach(item => {
        allArticles.push({
          id: item.guid || item.link,
          title: item.title,
          link: item.link,
          publishedAt: normalizeDate(item.isoDate || item.pubDate),
          fetchedAt: dayjs().toISOString(),
          source: source.name,
          content: item.contentSnippet || item.content || "",
          isStarred: false,
          isRead: false,
          memo: "",
          telegramSent: false
        });
      });
    } catch (e: any) {
      console.error(`[Fetcher] RSS ${source.name} error: ${e.message}`);
    }
  }

  // 2. Fetch Web Sources (Scraping) - Parallelized
  console.log(`[Fetcher] Scraping ${WEB_SOURCES.length} web sources in parallel...`);
  const webResults = await Promise.allSettled(WEB_SOURCES.map(async (source) => {
    const items = await scrapeWebSource(source);
    return items.map(item => ({
      id: item.link, // For scraped items, link is id
      title: item.title,
      link: item.link,
      publishedAt: normalizeDate(item.isoDate),
      fetchedAt: dayjs().toISOString(),
      source: source.name,
      content: item.contentSnippet,
      isStarred: false,
      isRead: false,
      memo: "",
      telegramSent: false
    }));
  }));

  webResults.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      allArticles.push(...result.value);
    } else {
      console.error(`[Fetcher] Scraping ${WEB_SOURCES[idx].name} failed critically:`, result.reason);
    }
  });

  const existingArticles = loadArticles();
  const existingIds = new Set(existingArticles.map(a => a.id));
  
  // Filtering and Deduplication
  const newItems = allArticles.filter(a => {
    if (!a.id || existingIds.has(a.id)) return false;
    
    const combinedText = (a.title + " " + a.content).toLowerCase();
    
    // 1. Must be related to Industry
    const hasIndustry = INDUSTRY_KEYWORDS.some(kw => combinedText.includes(kw.toLowerCase()));
    
    // 2. Must be an Event
    const hasEvent = EVENT_KEYWORDS.some(kw => combinedText.includes(kw.toLowerCase()));

    // Strict filter: Must satisfy BOTH industry context AND specific event/trigger
    return hasIndustry && hasEvent;
  });
  
  // Deduplicate within the new batch by title
  const uniqueNewItems = newItems.filter((v, i, a) => a.findIndex(t => t.title === v.title) === i);

  console.log(`[Fetcher] Found ${uniqueNewItems.length} new unique articles.`);

  if (uniqueNewItems.length > 0) {
    // Automatically notify and Fetch precise date for new articles - Parallelized (max 5 at a time to be polite)
    const processBatch = async (items: any[]) => {
      for (let i = 0; i < items.length; i += 5) {
        const batch = items.slice(i, i + 5);
        await Promise.allSettled(batch.map(async (article) => {
          try {
            // PROACTIVE: Fetch full content to get precise date from the article page
            const { content, preciseDate } = await fetchArticleContent(article.link);
            if (preciseDate) {
              article.publishedAt = normalizeDate(preciseDate);
            }
            if (content) {
              article.content = content;
            }
            await sendTelegramNotification(article);
            article.telegramSent = true;
          } catch (e: any) {
            console.error(`[Processor] Failed to process/notify for ${article.id}:`, e.message);
          }
        }));
      }
    };

    await processBatch(uniqueNewItems);

    const finalArticles = [...uniqueNewItems, ...existingArticles].sort((a, b) => {
      const timeA = new Date(a.publishedAt || a.fetchedAt).getTime();
      const timeB = new Date(b.publishedAt || b.fetchedAt).getTime();
      return timeB - timeA;
    });
    saveArticles(finalArticles.slice(0, 1000));
    return uniqueNewItems;
  }
  
  return [];
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Background Task: Every 5 minutes
  cron.schedule("*/5 * * * *", () => {
    console.log(`[Cron] [${dayjs().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')}] Periodic sync triggered.`);
    fetchAndProcessNews();
  });

  // Run once on startup if DB is empty
  const initialData = loadArticles();
  if (initialData.length === 0) {
    fetchAndProcessNews();
  }

  // --- API Routes ---

  app.get("/api/articles", (req, res) => {
    res.json(loadArticles());
  });

  app.post("/api/articles/sync", async (req, res) => {
    try {
      await fetchAndProcessNews();
      res.json({ status: "ok", data: loadArticles() });
    } catch (e: any) {
      console.error("[API] Sync Failed:", e);
      res.status(500).json({ status: "error", error: e.message });
    }
  });

  app.post("/api/articles/star", (req, res) => {
    const { id, isStarred } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex(a => a.id === id);
    if (index > -1) {
      articles[index].isStarred = isStarred;
      saveArticles(articles);
      res.json(articles[index]);
    } else {
      res.status(404).json({ error: "Not found", receivedId: id });
    }
  });

  app.post("/api/articles/clear", (req, res) => {
    saveArticles([]);
    res.json({ message: "Cleared" });
  });

  app.post("/api/articles/analysis", async (req, res) => {
    const { id } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex(a => a.id === id);
    if (index === -1) return res.status(404).json({ error: "Not found", receivedId: id });

    try {
      const article = articles[index];
      const aiResult = await analyzeArticleContent(article);
      
      if (aiResult) {
        articles[index] = { ...article, ...aiResult, aiAnalyzed: true };
        
        // Send updated notification after manual analysis if it was already sent or if high importance
        if (articles[index].telegramSent || articles[index].importance === 'high') {
          console.log(`[Analysis] Sending summary for: ${articles[index].title}`);
          await sendTelegramNotification(articles[index]);
          articles[index].telegramSent = true;
        }
        
        saveArticles(articles);
        res.json(articles[index]);
      } else {
        res.status(500).json({ error: "AI 분석 결과가 비어있습니다. 본문 수집에 실패했거나 모델 응답 오류일 수 있습니다." });
      }
    } catch (e: any) {
      console.error("Manual Analysis Error:", e);
      res.status(500).json({ error: e.message || "AI 분석 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/articles/memo", (req, res) => {
    const { id, memo } = req.body;
    const articles = loadArticles();
    const index = articles.findIndex(a => a.id === id);
    if (index > -1) {
      articles[index].memo = memo;
      saveArticles(articles);
      res.json(articles[index]);
    } else {
      res.status(404).json({ error: "Not found", receivedId: id });
    }
  });

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
