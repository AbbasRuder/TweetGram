# Project Context - Twitter to Telegram Bot

## What this system does

This project is an AI-powered tweet filter that sends a curated batch of tech-focused tweets to a Telegram chat. It uses natural language processing to allow the user to refine filtering rules dynamically.

1. **Hourly Cron Job** (`npm run bot` via GitHub Actions)
   - Fetches tweets from Apify using random topic queries.
   - Filters out retweets, replies, thread children, and spam.
   - Uses Gemini to score tweets against "Master Rules" stored in Apify KV.
   - Sends the top 15 tweets to Telegram as a clean, numbered list.

2. **Real-time Rule Updates** (`api/webhook.ts` via Serverless/Vercel)
   - Listens for natural language messages from the user on Telegram.
   - Uses Gemini to interpret instructions (e.g., "Stop showing me crypto").
   - Dynamically updates the "Master Rules" in Apify KV.
   - Automatically backs up old rules before every update.
   - Confirms the update to the user instantly.

## High-level architecture

- `src/index.ts` -> Bot orchestration (Cron job)
- `api/webhook.ts` -> Natural language feedback handler (Serverless)
- `src/config/*` -> Environment parsing and constants
- `src/lib/*` -> Shared infrastructure (Telegram, KV Store, Tweet helpers)
- `src/bot/scoring.ts` -> AI-based relevance filtering
- `src/types/domain.ts` -> Shared domain types

## System invariants

1. **Tweet selection invariant**
   - Only main tweets: no retweets, replies, or thread children.

2. **Natural Language Rule Update invariant**
   - Every rule update must be processed by Gemini to merge new instructions with existing ones.
   - A backup of the rules must be created in KV store before any overwrite.

3. **Authorized Access invariant**
   - The webhook must ignore messages not originating from the configured `TELEGRAM_CHAT_ID`.

4. **Entrypoint readability invariant**
   - `src/index.ts` and `api/webhook.ts` stay thin and orchestration-focused.

## Key helpers

### `src/lib/tweet.ts`
- `getTweetAuthor(tweet)`, `getTweetText(tweet)`, `getTweetUrl(tweet)`
- `isSpam(text)`, `isMainOrParentTweet(tweet)`

### `src/lib/kvStore.ts`
- `loadFromKv<T>(kvStore, key, fallback)`
- `saveTextToKv(kvStore, key, value)`: Used for Master Rules.
- `saveJsonToKv(kvStore, key, value)`

### `src/lib/telegram.ts`
- `sendMessage(chatId, text, options)`: Send plain or HTML messages.
- `sendFeedbackBatch(tweets)`: Sends the formatted tweet list.

### `src/config/env.ts`
- `getEnv()`, `assertBotEnv(env)`

## Runbook

- Install deps: `npm install`
- Manual bot run: `npm run bot`
- Type-check: `npm run typecheck`
- Webhook deployment: Deploy to Vercel/Cloudflare and set `setWebhook` on Telegram.

## GitHub Actions

- `.github/workflows/cron.yml` runs `npm run bot` hourly.
- (Deprecated) `train.yml` and `src/train.ts` have been removed in favor of real-time updates.

## Rules for adding/changing code

1. **Always search before writing helper code**
2. **If helper needs extension, extend in one place**
3. **Keep entrypoints simple**
4. **Preserve behavior unless explicitly requested**
5. **Type safety first**
6. **Context Maintenance**
   - **IMPORTANT:** Whenever a major architectural shift occurs (like the move from structured feedback to natural language webhooks), **this `context.md` file MUST be updated immediately** to reflect the new reality.

## Notes for future chat instances

When proposing changes, explicitly state:
1. Which existing helper(s) are reused.
2. Which module owns the new logic.
3. Which invariant(s) are affected.
