# BioTicker Enterprise Technical Memo

This memo summarizes the core logic and current state of the BioTicker application for consultation with other AI systems.

## 1. Project Overview
- **Name**: BioTicker Enterprise
- **Purpose**: Real-time news aggregator for the Bio/Pharma industry.
- **Key Features**: RSS/Web scraping, Deduplication, AI Analysis (GPT-4o-mini), Telegram notifications, and grouped news clustering.

## 2. Core Architecture
- **Backend**: Express + Node.js (TypeScript)
- **Frontend**: React + Tailwind CSS (Vite)
- **Storage**: JSON-based local file (`articles.json`).

---

## 3. News Processing Pipeline

### A. Scraping & Deduplication
- **Sources**: 3 RSS feeds + 20+ specialized Korean Bio news websites.
- **Deduplication Strategy**: 
  - `ArticleDedupKey`: `(Normalized Link) | (Source Name) | (Normalized Title)`
  - `NotificationDedupKey`: `(Source Name) | (Normalized Title)`
- **Industry Filter**: Articles must contain at least one `INDUSTRY_KEYWORDS` and one `EVENT_KEYWORDS` to be considered "relevant".

### B. Time Extraction Logic (`publishedAt`)
**Objective**: Extract the *original* article publication time accurately, avoiding "Modified" (수정) times or scraper-time fallbacks.

#### Extraction Priorities:
1.  **Meta Tags**: `article:published_time`, `og:published_time`, `date`, `pubdate`, `publishdate`, `published_time`.
2.  **JSON-LD**: Parsing `script[type="application/ld+json"]` for `datePublished`.
3.  **Body Text Patterns**: regex matching for "입력", "등록", "발행" while strictly **excluding** times preceded by "수정" (modified).
4.  **Time Tags**: `time[datetime]` attribute.

#### Code Snippet (Extraction Pattern):
```typescript
const patterns = [
  /(?:입력|기사입력|등록|발행|승인)\s*[:]?\s*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s+(?:\d{1,2}:\d{2}(?::\d{2})?)?)/i,
  /(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/,
];
// Logic checks contextBefore.includes("수정") to filter out modified times.
```

### C. Timezone & Normalization
- **Strict Asia/Seoul Policy**: 
  - If a string has TZ info (Z, +09:00), `dayjs` parses it directly.
  - If NOT present, it is forced to `Asia/Seoul` using `dayjs.tz(str, "Asia/Seoul")`.
- **UI Logic**: Display `publishedAt` (if exists) and `fetchedAt` separately. `publishedAt` is never fallbacked to `fetchedAt` to avoid misleading users.

---

## 4. Key AI & Verification Features

### A. AI Analysis (OpenAI)
- **Model**: `gpt-4o-mini` (with defensive model-name checking to avoid API key leaks).
- **Function**: Categorizes news (Clinical, Approval, Deal, etc.) and generates a 3-5 line summary + extracted Entities (Companies/Products).

### B. Telegram Sync
- **Auto-Sync**: Every 5 minutes via cron.
- **Logic**: Sends rich HTML messages including AI summary if available.

### C. Published Time Revalidation
- **Endpoint**: `POST /api/articles/revalidate-published-at`
- **Function**: Iterates through all historical articles, re-fetches the original URL, and attempts to re-parse the `publishedAt` using the hardened priority logic.

---

## 5. Known Constraints & Design Decisions
- **Port**: Strictly 3000.
- **No iFrame Alert**: Avoids `window.alert` due to iframe constraints in the preview environment.
- **Responsive Grid**: Uses a 2-column bento-grid on desktop (`xl:grid-cols-2`).
- **Clustering**: Groups similar news based on title similarity (>75% overlap) to reduce noise.

---

## 6. Article Data Schema
```typescript
interface Article {
  id: string; // Absolute link
  title: string;
  link: string;
  publishedAt: string | null; // Original publication time (ISO)
  rssPublishedAt: string | null; // Raw RSS pubDate
  publishedAtSource: string; // Traceability (e.g., 'original_meta', 'original_text', 'not_found')
  fetchedAt: string; // Actual time crawled
  source: string;
  type: ArticleType; // AI generated
  aiAnalyzed: boolean;
  summary: string;
  // ... extra fields: importance, entities, isStarred, isRead, memo
}
```
