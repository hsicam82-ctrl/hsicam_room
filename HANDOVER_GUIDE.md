# BioTicker Enterprise - Technical Handover

## Project Overview

BioTicker Enterprise is a full-stack intelligence dashboard for Korean healthcare, pharma, and bio industry news.

The intended workflow is:

1. The server periodically collects new articles from RSS and web sources.
2. New articles are stored in `articles.json`.
3. A user reviews the dashboard.
4. Newly collected articles are automatically sent to Telegram.
5. A user manually runs OpenAI GPT analysis on selected articles.
6. A user can manually resend a Telegram alert when needed.

Automatic collection and automatic Telegram delivery are enabled. Automatic AI analysis is intentionally disabled.

## Stack

- Frontend: React, Vite, Tailwind CSS, Lucide React, Motion, React Day Picker, XLSX
- Backend: Express, Vite middleware, Axios, Cheerio, RSS Parser, OpenAI SDK, node-cron
- Storage: local JSON file at `articles.json`
- AI: OpenAI GPT via `OPENAI_API_KEY`
- Notification: Telegram Bot API, manual trigger only

## Main Files

- `server.ts`: API server, scraping, JSON storage, automatic Telegram delivery, manual AI analysis
- `src/App.tsx`: monitoring dashboard UI
- `.env.example`: required environment variables
- `articles.json`: local data store

## API Behavior

- `GET /api/articles`: return stored articles
- `POST /api/articles/sync`: collect news, store matching articles, and send new articles to Telegram once
- `POST /api/articles/analysis`: manually analyze one article with OpenAI
- `POST /api/articles/notify`: manually resend one article to Telegram
- `POST /api/articles/star`: update starred state
- `POST /api/articles/read`: update read state
- `POST /api/articles/memo`: update memo
- `POST /api/articles/clear`: clear data, requires `DELETE_ALL_ARTICLES`
- `GET /api/health`: health check

## Operational Notes

- The server listens on `0.0.0.0:3000` by default.
- Cron sync runs every 5 minutes, collects articles, and sends Telegram alerts for newly collected articles.
- Duplicate Telegram sends are prevented with normalized link/title keys plus the stored `telegramSent` flag.
- `fetchAndProcessNews` has a simple in-flight lock so manual and cron syncs do not overlap.
- `saveArticles` writes through a temporary file before replacing `articles.json`.
- If a source layout changes, update `scrapeWebSource` or `fetchArticleContent` in `server.ts`.

## Recommended Next Improvements

- Move from JSON file storage to SQLite or Firestore before multi-user deployment.
- Add authentication before exposing destructive or notification endpoints outside localhost.
- Add per-source scrape success metrics in the dashboard.
- Add a keyword/watchlist settings UI for companies, products, and event types.
- Add tests for date normalization, deduplication, filtering, and API mutations.
