# Copilot Instructions

You are a senior developer working on the Twitter to Telegram Bot.

## Project Context
The primary source of truth for the project's architecture, helpers, and invariants is the `context.md` file in the root directory.

## Core Mandates
1. **Reference `context.md` First:** Before suggesting any code changes or adding new functionality, read the `context.md` file. Adhere strictly to the "Rules for adding/changing code" section.
2. **Helper-First Development:** Do not reinvent logic. Check `src/lib/` for existing helpers (Telegram, KV Store, Tweet processing) and reuse them.
3. **Keep Entrypoints Thin:** Business logic should live in `src/bot/` or `src/lib/`. The main entrypoints (`src/index.ts` for cron, `api/webhook.ts` for webhook) should only orchestrate high-level steps.
4. **Architectural Consistency:** We use a split architecture: GitHub Actions for hourly scraping and Vercel Serverless Functions for real-time Telegram feedback.
5. **Update Context on Shift:** If a change constitutes a significant architectural shift, you MUST suggest updating `context.md` to reflect the new design.

## Technical Preferences
- Use TypeScript with strict mode.
- Prefer `CommonJS` as configured in `package.json`.
- Use `tsx` for running scripts locally.
- Use `Gemini 1.5 Flash` for AI-based filtering and rule updates.
