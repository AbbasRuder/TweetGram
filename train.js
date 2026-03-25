/**
 * train.js — Daily Brain Trainer
 *
 * This script runs once a day (via GitHub Actions cron).
 * It pulls ALL historical feedback from Apify KV Store,
 * checks if we have enough data (minimum threshold),
 * feeds it to Gemini to synthesize a Master Ruleset,
 * and saves the rules back to Apify KV Store.
 */

require('dotenv').config();
const { ApifyClient } = require('apify-client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Environment Variables ───────────────────────────────────────────
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const KV_STORE_NAME = 'twitter-bot-brain';
const FEEDBACK_KEY = 'feedback';
const RULES_KEY = 'master-rules';

// Minimum number of total feedback entries before we attempt to train.
// If the user hasn't provided enough data yet, we skip and wait for more.
const MIN_FEEDBACK_THRESHOLD = 15;

const apifyClient = new ApifyClient({ token: APIFY_TOKEN });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ─── Apify KV Store Helpers ──────────────────────────────────────────
async function getOrCreateKvStore() {
    const stores = await apifyClient.keyValueStores().list();
    let store = stores.items.find(s => s.name === KV_STORE_NAME);
    if (!store) {
        store = await apifyClient.keyValueStores().getOrCreate(KV_STORE_NAME);
    }
    return apifyClient.keyValueStore(store.id);
}

async function loadFromKv(kvStore, key, fallback) {
    try {
        const record = await kvStore.getRecord(key);
        return record ? record.value : fallback;
    } catch {
        return fallback;
    }
}

async function saveToKv(kvStore, key, value) {
    await kvStore.setRecord({ key, value, contentType: 'application/json' });
}

async function saveTextToKv(kvStore, key, value) {
    await kvStore.setRecord({ key, value, contentType: 'text/plain' });
}

// ─── Main Training Logic ────────────────────────────────────────────
async function train() {
    console.log('═══════════════════════════════════════════');
    console.log('  🧠 Brain Trainer — Daily Rule Synthesis');
    console.log('═══════════════════════════════════════════');

    if (!APIFY_TOKEN || !GEMINI_API_KEY) {
        console.error('Missing required env vars: APIFY_TOKEN, GEMINI_API_KEY');
        process.exit(1);
    }

    const kvStore = await getOrCreateKvStore();

    // ── Step 1: Load all historical feedback ──
    const feedbackLog = await loadFromKv(kvStore, FEEDBACK_KEY, []);
    console.log(`Total feedback entries in history: ${feedbackLog.length}`);

    // ── Step 2: Check minimum threshold ──
    if (feedbackLog.length < MIN_FEEDBACK_THRESHOLD) {
        console.log(`Not enough feedback yet (${feedbackLog.length}/${MIN_FEEDBACK_THRESHOLD}). Skipping training.`);
        console.log('The brain will train once more feedback is collected. Exiting gracefully.');
        return;
    }

    // ── Step 3: Separate liked and disliked tweets ──
    const liked = feedbackLog.filter(f => f.rating === 'good');
    const disliked = feedbackLog.filter(f => f.rating === 'bad');

    console.log(`Liked: ${liked.length} | Disliked: ${disliked.length}`);

    // Format feedback for the LLM
    const formatEntries = (entries, label) => {
        if (entries.length === 0) return `No ${label} tweets yet.`;
        return entries.map((e, i) =>
            `${i + 1}. ${e.tweetSnippet}`
        ).join('\n');
    };

    const likedText = formatEntries(liked, 'liked');
    const dislikedText = formatEntries(disliked, 'disliked');

    // ── Step 4: Load existing rules (for context) ──
    const existingRules = await loadFromKv(kvStore, RULES_KEY, '');

    // ── Step 5: Synthesize new Master Rules via Gemini ──
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are an expert at analyzing user preferences from examples.

A tech founder has been rating tweets as "Good" (worth replying to) or "Bad" (not interesting).
Your job is to analyze ALL of their historical feedback below and produce a comprehensive, strict RULESET that describes exactly what types of tweets this person wants to see vs. what they want filtered out.

${existingRules ? `Here are the PREVIOUS rules (use as a starting point, but update/override based on the new data below):\n---\n${existingRules}\n---\n` : ''}

=== TWEETS THE USER LIKED (${liked.length} total) ===
${likedText}

=== TWEETS THE USER DISLIKED (${disliked.length} total) ===
${dislikedText}

Now produce a MASTER RULESET as a clear bulleted list. Include:
1. **MUST INCLUDE** rules — Topics, themes, keywords, and tweet styles the user actively engages with.
2. **MUST EXCLUDE** rules — Topics, themes, keywords, and tweet styles the user dislikes.
3. **QUALITY SIGNALS** — Patterns that indicate a tweet is high-quality vs. low-quality for this user.
4. **TONE PREFERENCES** — Does the user prefer conversational tweets, hot takes, technical deep dives, questions, etc?

Be very specific and data-driven. Reference concrete examples from their feedback where possible.
Output ONLY the ruleset, nothing else.`;

    try {
        console.log('Sending feedback history to Gemini for analysis...');
        const result = await model.generateContent(prompt);
        const newRules = result.response.text();

        console.log('\n── New Master Rules ──────────────────────');
        console.log(newRules);
        console.log('──────────────────────────────────────────\n');

        // ── Step 6: Save new rules to Apify KV Store ──
        await saveTextToKv(kvStore, RULES_KEY, newRules);
        console.log('✅ Master Rules updated and saved to Apify KV Store.');

        // Also save a timestamped backup
        const backupKey = `rules-backup-${new Date().toISOString().split('T')[0]}`;
        await saveTextToKv(kvStore, backupKey, newRules);
        console.log(`📦 Backup saved as "${backupKey}"`);

    } catch (error) {
        console.error('❌ Gemini training failed:', error.message);
        process.exit(1);
    }
}

train();
