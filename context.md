# Project Context — Twitter → Telegram Bot (TypeScript)

## What this system does

This project runs two production jobs:

1. **Bot Run** (`npm run bot`)
   - Collects Telegram feedback from inline button clicks.
   - Fetches tweets from Apify using one random topic query.
   - Filters tweets to keep only:
     - non-retweets
     - non-replies
     - only thread parent / original tweets
   - Removes local spam.
   - Uses Gemini to rank relevance based on learned rules.
   - Sends top tweets to Telegram with 👍/👎 feedback buttons.

2. **Training Run** (`npm run train`)
   - Reads full feedback history from Apify KV store.
   - Skips training until `MIN_FEEDBACK_THRESHOLD` is reached.
   - Synthesizes an updated master ruleset via Gemini.
   - Saves new rules + a dated backup.

## High-level architecture

- `src/index.ts` → orchestration only for bot run (readable overview).
- `src/train.ts` → orchestration only for daily training (readable overview).
- `src/config/*` → env parsing + constants.
- `src/lib/*` → reusable infrastructure/helpers (KV, tweet utils, Telegram client).
- `src/bot/*` → bot-specific logic (feedback ingestion, scoring).
- `src/train/*` → training-specific logic (rules synthesis prompt logic).
- `src/types/domain.ts` → shared domain types.

## System invariants (must not be broken)

1. **Tweet selection invariant**
   - Only main tweets should be sent: no replies, no retweets, no child tweets in a thread.
   - Enforced by `isMainOrParentTweet` and used in `filterTweets`.

2. **Feedback persistence invariant**
   - Feedback appends to history, does not overwrite.
   - Duplicate callback events are deduped by `eventId`.

3. **Offset invariant**
   - Telegram update offset is persisted and advanced to avoid re-processing old updates.

4. **Entrypoint readability invariant**
   - `src/index.ts` and `src/train.ts` must stay thin and easy to skim.
   - Move complexity into helper/service modules.

## Existing helper functions (reuse these; do not recreate)

### `src/lib/tweet.ts`
- `escapeHtml(text)`
- `normalizeId(value)`
- `getTweetAuthor(tweet)`
- `getTweetText(tweet)`
- `getTweetId(tweet, fallback?)`
- `getTweetUrl(tweet, fallbackIndex?)`
- `isSpam(text)`
- `isRetweet(tweet)`
- `isReply(tweet)`
- `isThreadChild(tweet)`
- `isMainOrParentTweet(tweet)`

### `src/lib/kvStore.ts`
- `getOrCreateKvStore(apifyClient)`
- `loadFromKv<T>(kvStore, key, fallback)`
- `saveJsonToKv(kvStore, key, value)`
- `saveTextToKv(kvStore, key, value)`

### `src/lib/telegram.ts`
- `createTelegramClient(config)` returning:
  - `sendAggregatedTweets(tweets)`
  - `getUpdates(offset)`
  - `answerCallbackQuery(callbackQueryId, rating)`

### `src/config/env.ts`
- `getEnv()`
- `assertBotEnv(env)`
- `assertTrainingEnv(env)`

### `src/bot/feedback.ts`
- `collectFeedback(kvStore, telegramClient)`
- internal helpers already present in this module (reuse/extend here, do not duplicate elsewhere):
  - `parseFeedbackCallbackData(callbackData)`
  - `getTweetSnippetFromMessage(messageText, index)`
  - `appendFeedbackEntries(kvStore, newEntries)`

### `src/bot/scoring.ts`
- `scoreTweetsWithAI(genAI, tweets, masterRules)`

### `src/train/synthesizer.ts`
- `synthesizeMasterRules(genAI, feedbackLog, existingRules)`
- internal helper:
  - `formatEntries(entries, label)`

### `src/index.ts` local orchestration helpers
- `pickRandomQuery()`
- `fetchTweets(apifyClient, actorId, query)`
- `filterTweets(rawTweets)`
- `runBot()`

### `src/train.ts` orchestration helper
- `runTraining()`

## Rules for adding/changing code

1. **Always search before writing helper code**
   - Check existing helpers in `src/lib`, `src/bot`, `src/train`.
   - If a helper exists, import and use it.
   - Do not create duplicate logic with different names.

2. **If helper needs extension, extend in one place**
   - Update the existing helper module.
   - Keep callers thin and reuse updated helper.

3. **Keep entrypoints simple**
   - `src/index.ts` and `src/train.ts` should read like a story of steps.
   - No heavy parsing/formatting/business logic inline in entrypoints.

4. **Preserve behavior unless explicitly requested**
   - Keep the main-tweet-only filtering behavior.
   - Keep dedupe + append behavior for feedback persistence.

5. **Type safety first**
   - Use domain types from `src/types/domain.ts`.
   - Add/adjust types before adding ad-hoc `any`.

6. **Small focused modules**
   - New integrations/features should go into dedicated files (`src/bot/*`, `src/lib/*`, etc.) and be wired from entrypoints.

7. **Validation before finishing**
   - Run `npm run typecheck` for every change.
   - Run `npm run bot` and/or `npm run train` when relevant.

## Practical extension patterns

- **Add a new filter rule**
  - Implement in `src/lib/tweet.ts` and integrate inside `filterTweets` in `src/index.ts`.

- **Add a new feedback field**
  - Update `FeedbackEntry` in `src/types/domain.ts`.
  - Update ingestion in `src/bot/feedback.ts`.

- **Add a new persistence key**
  - Add key constant in `src/config/constants.ts`.
  - Read/write using KV helpers only.

- **Add a new bot feature**
  - Create a new `src/bot/<feature>.ts` module.
  - Keep `src/index.ts` as orchestration.

## Runbook

- Install deps: `npm install`
- Bot run (manual): `npm run bot`
- Training run (manual): `npm run train`
- Type-check: `npm run typecheck`

## GitHub Actions wiring

- `.github/workflows/cron.yml` runs `npm run bot`.
- `.github/workflows/train.yml` runs `npm run train`.

## Notes for future chat instances

When proposing changes, explicitly state:
1. Which existing helper(s) are reused.
2. Which module owns the new logic.
3. Which invariant(s) are affected and how they are preserved.
