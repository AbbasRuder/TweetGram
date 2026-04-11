# Project Context - Twitter to Telegram Bot

## What this system does
This project is an AI-powered tweet filter that sends a curated batch of tech-focused tweets to a Telegram chat. It has transitioned to a cost-effective Twitter List scraping strategy.

1. **Hourly Cron Job** (`npm run bot` via GitHub Actions)
   - Fetches latest tweets from a specific Twitter List ID stored in Apify KV.
   - **Fallback Mechanism:** If the list returns fewer than 15 fresh tweets, it automatically runs a search for "build in public" topics to fill the batch.
   - **Daily Stats Tracking:** Every second run (approx. every 2 hours), it fetches the number of replies sent by the user (`@abbashali01`) today and the current monthly Apify spend in USD.
   - Filters out tweets older than 5 hours to ensure high relevance and visibility.
   - Sorts tweets by `createdAt` descending (latest first).
   - Implements cross-run deduplication by storing sent tweet IDs in Apify KV.

2. **Real-time Updates** (`api/webhook.ts` via Serverless/Vercel)
   - Listens for natural language messages from the user on Telegram.
   - Uses OpenAI (NVIDIA DeepSeek) to interpret instructions for rules, target account lists, and the Twitter List ID.
   - Dynamically updates "Master Rules", "Target Accounts", and "Target List ID" in Apify KV.
   - Automatically backs up all state before every update.

## High-level architecture

- `src/index.ts` -> Bot orchestration (Entrypoint)
- `src/bot/accountScraper.ts` -> Active List-based scraping logic (using static List ID)
- `src/bot/legacyScraper.ts` -> Dormant topic-based scraping logic
- `api/webhook.ts` -> Natural language config handler (extracts List ID)
- `src/config/*` -> Environment parsing and constants
- `src/lib/*` -> Shared infrastructure (Telegram, KV Store, Tweet helpers)

## System invariants

1. **Tweet selection invariant**
   - Only main tweets: no retweets, replies, or thread children.

2. **Freshness invariant**
   - Only tweets posted within the last 5 hours are eligible for sending.

3. **Cost Efficiency invariant**
   - Primary fetching must use the static Twitter List ID strategy to stay within the Apify free tier.

4. **Cross-Run Deduplication invariant**
   - Sent tweet IDs must be persisted in KV store to prevent duplicates across runs.



5. **Entrypoint readability invariant**
   - `src/index.ts` and `api/webhook.ts` stay thin and orchestration-focused.

## Key helpers

### `src/bot/accountScraper.ts`
- `runAccountBot(env)`: Orchestrates fetching from a Twitter List, filtering, and deduplication.

### `src/config/constants.ts`
- `TARGET_LIST_ID_KEY`, , `SEEN_TWEETS_KEY`, `RULES_KEY`
- `MAX_TWEETS_FOR_TELEGRAM`, `MAX_TWEETS_PER_FETCH`

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
   - **MANDATORY:** Run `npm run typecheck` after every single code change. A change is not complete until it passes type safety.
6. **Context Maintenance**
   - **IMPORTANT:** Whenever a major architectural shift occurs (like the move from structured feedback to natural language webhooks), **this `context.md` file MUST be updated immediately** to reflect the new reality.

## Notes for future chat instances

When proposing changes, explicitly state:
1. Which existing helper(s) are reused.
2. Which module owns the new logic.
3. Which invariant(s) are affected.
