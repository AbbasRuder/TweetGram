# Project Context - Twitter to Telegram Bot

## What this system does

This project runs two jobs:

1. `npm run bot`
   - Finalizes feedback replies for the previous Telegram batch.
   - Fetches tweets from Apify using one random topic query.
   - Filters out retweets, replies, thread children, and spam.
   - Uses Gemini to rank relevance based on learned rules.
   - Sends the top tweets to Telegram as one numbered batch.
   - Sends two `ForceReply` prompts:
     - liked tweet numbers
     - disliked tweet numbers

2. `npm run train`
   - Reads the feedback history from Apify KV.
   - Skips training until `MIN_FEEDBACK_THRESHOLD` is reached.
   - Synthesizes a refined ruleset with Gemini.
   - Saves the latest rules plus a dated backup.

## High-level architecture

- `src/index.ts` -> bot orchestration
- `src/train.ts` -> training orchestration
- `src/config/*` -> env parsing and constants
- `src/lib/*` -> shared helpers and infrastructure
- `src/bot/*` -> feedback ingestion and AI scoring
- `src/train/*` -> master-rule synthesis logic
- `src/types/domain.ts` -> shared domain types

## System invariants

1. Tweet selection invariant
   - Only main tweets should be sent: no retweets, replies, or thread children.

2. Feedback persistence invariant
   - Feedback appends to history and is deduped by update and tweet identity.

3. Batch lifecycle invariant
   - Only one active feedback batch exists at a time.
   - A batch is finalized at the start of the next bot run.

4. Offset invariant
   - Telegram update offset is persisted only after the current batch state has been saved.

5. Entrypoint readability invariant
   - `src/index.ts` and `src/train.ts` stay thin and orchestration-focused.

## Key helpers

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
- `createTelegramClient`
  - `sendFeedbackBatch`
  - `getUpdates`

### `src/config/env.ts`
- `getEnv()`
- `assertBotEnv(env)`
- `assertTrainingEnv(env)`

### `src/bot/feedback.ts`
- `collectFeedback`
- `createActiveFeedbackBatch`
- `saveActiveFeedbackBatch`
- `parseNumberList`
- `isNoneReply`
- `resolvePromptKind`
- `finalizeBatchReplies`

### `src/bot/scoring.ts`
- `scoreTweetsWithAI`

### `src/train/synthesizer.ts`
- `synthesizeMasterRules`

## Runbook

- Install deps: `npm install`
- Manual bot run: `npm run bot`
- Manual training run: `npm run train`
- Type-check: `npm run typecheck`

## GitHub Actions

- `.github/workflows/cron.yml` runs `npm run bot`.
- `.github/workflows/train.yml` runs `npm run train`.

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

## Notes for future chat instances

When proposing changes, explicitly state:
1. Which existing helper(s) are reused.
2. Which module owns the new logic.
3. Which invariant(s) are affected and how they are preserved.
