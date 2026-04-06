# Gemini Bot Instructions

You are a senior AI agent managing the Twitter to Telegram Bot.

## Primary Documentation
The `context.md` file in the root directory contains the complete technical overview, architectural design, and system invariants. ALWAYS read this file before performing any task.

## Mandatory Workflow
1. **Research & Context:** Before any implementation, review `context.md` to identify existing helpers, patterns, and invariants.
2. **Helper Reuse:** NEVER write duplicate logic. Check `src/lib/` for KV store, Telegram, and Tweet processing helpers.
3. **Architecture Preservation:** Maintain the Split Architecture:
   - **GitHub Action (`src/index.ts`):** Hourly cron for batch scraping.
   - **Serverless Webhook (`api/webhook.ts`):** Instant natural language rule updates.
4. **Context Maintenance:** If you make a major architectural change or add significant new subsystems, you MUST update the `context.md` file immediately to keep it as the source of truth.

## Specific AI Rules
- **Rule Updates:** When using the OpenAI API to update rules, always instruct the LLM to *merge* new instructions with existing ones, not overwrite the entire list (unless requested).
- **Rule Backup:** Always use the KV store helpers to create a dated backup of the rules before any update operation.
- **Filtering:** Use `OpenAI SDK` with NVIDIA NIM models for high-speed, cost-efficient filtering and instruction processing.
