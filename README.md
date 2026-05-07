# BioTicker Enterprise

Korean healthcare and bio-pharma news monitoring dashboard.

## What It Does

- Collects Korean pharma/bio news from RSS and web sources.
- Stores articles in `articles.json`.
- Automatically sends newly collected articles to Telegram.
- Prevents duplicate Telegram sends using normalized link/title keys and stored send state.
- Lets the user manually run OpenAI GPT analysis per article.
- Lets the user manually resend a Telegram alert per article when needed.
- Provides filtering by date, topic, source, company, unread, and starred state.
- Exports the current filtered view to Excel.

AI analysis is intentionally manual. Background collection never runs AI analysis, but newly collected articles are sent to Telegram automatically when Telegram credentials are configured.

## Run Locally

Prerequisite: Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` if you want automatic Telegram delivery for newly collected articles.
4. Run:
   `npm run dev`
5. Open:
   `http://localhost:3000`

## Environment Variables

- `OPENAI_API_KEY`: OpenAI API key for manual article analysis.
- `OPENAI_MODEL`: Optional model override. Defaults to `gpt-4o-mini`.
- `TELEGRAM_BOT_TOKEN`: Optional bot token for automatic new-article alerts and manual resends.
- `TELEGRAM_CHAT_ID`: Optional target chat/channel ID.
- `PORT`: Optional server port. Defaults to `3000`.
