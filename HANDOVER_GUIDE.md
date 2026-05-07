# BioTicker Enterprise - Technical Handover & Architecture Guide

This document serves as a comprehensive technical overview and handover guide for the BioTicker Enterprise application.

## 1. Project Overview
BioTicker Enterprise is a full-stack real-time intelligence hub designed to aggregate, analyze, and notify healthcare industry news from 13+ specialized Korean news sources.

- **Architecture**: Express.js (Backend) + React (Frontend - Vite)
- **Primary Goal**: Detect new articles, perform AI analysis (Sentiment/Summary), and notify via Telegram.

## 2. Technical Stack
- **Frontend**: React 18, Tailwind CSS, Lucide React (Icons), Framer Motion (Animations), DayJS, React Day Picker (Calendar).
- **Backend**: Node.js (via `tsx`), Express, Cheerio (Web Scraping), Axios, OpenAI/Gemini SDK.
- **Storage**: File-based JSON storage (`articles.json`) optimized for containerized environments without dedicated DBs.

## 3. Core Logic (Server-side: `server.ts`)

### News Sources
The app monitors the following sources via customized selectors:
- 의협신문, 청년의사, 메디게이트, 데일리메디, 약사공론, 메디파나뉴스, etc.

### The `fetchAndProcessNews` Workflow:
1. **Scraping**: Parallel scraping of all `WEB_SOURCES` using Cheerio.
2. **Deduplication**: Comparing incoming links against `articles.json` IDs.
3. **Proactive Enrichment**: For new articles, it fetches the full content to extract precise timestamps (bypassing generic "YY-MM-DD" formats).
4. **AI Processing**: New articles are analyzed using `models/gemini-1.5-flash` for:
    - **Summary**: Concise 3-line bullet points.
    - **Sentiment**: Neutral, Positive, or Negative.
5. **Notification**: Dispatches real-time alerts to Telegram.

## 4. Environment Variables
To run this project, the following secrets must be configured:
- `GEMINI_API_KEY`: For AI article analysis.
- `TELEGRAM_BOT_TOKEN`: The bot token from @BotFather.
- `TELEGRAM_CHAT_ID`: The target channel or user ID.

## 5. UI/UX Features (Client-side: `App.tsx`)
- **Responsive Calendar**: Custom-styled `DayPicker` with mobile-first responsiveness.
- **Dynamic Filtering**: Multi-condition filtering (Unread, Starred, Category, Date Range).
- **Offline Reliability**: State-driven UI that handles sync errors gracefully.

## 6. Manual Synchronization
The `/api/articles/sync` endpoint handles manual triggers from the UI. It is now parallelized to ensure fast response times on mobile devices.

## 7. Critical Maintenance Notes
- **Port Mapping**: The server MUST listen on `0.0.0.0:3000`.
- **Date Normalization**: All dates are normalized to `Asia/Seoul` time (KST) before being stored as ISO strings.
- **Scraper Stability**: If a news source changes its layout, update `scrapeWebSource` or `fetchArticleContent` selectors in `server.ts`.

---
*Created on: 2026-05-07*
*Author: BioTicker Dev System (AI AI Studio)*
