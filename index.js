require('dotenv').config();
const { ApifyClient } = require('apify-client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// ─── Environment Variables ───────────────────────────────────────────
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ACTOR_ID = process.env.APIFY_ACTOR_ID || 'kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest';

const MAX_TWEETS_PER_FETCH = 30;
const MAX_TWEETS_FOR_TELEGRAM = 15;
const KV_STORE_NAME = 'twitter-bot-brain';
const FEEDBACK_KEY = 'feedback';
const RULES_KEY = 'master-rules';

const apifyClient = new ApifyClient({ token: APIFY_TOKEN });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);


// ─── Search Queries ──────────────────────────────────────────────────
const TOPIC_QUERIES = [
    // Micro-SaaS & Build in public
    '(#buildinpublic OR "micro saas" OR "microsaas" OR #indiehackers) min_faves:4 lang:en -crypto -nft -web3 -btc',
    // Coding & Web Dev
    '("software engineering" OR "web development" OR #100DaysOfCode OR "reactjs" OR "nextjs") min_faves:5 lang:en -crypto -nft',
    // AI, Agents, Frontier Tech
    '("AI agents" OR "LLMs" OR OpenAI OR Anthropic OR Cursor OR "generative ai" OR Gemini) min_faves:10 lang:en -crypto -nft',
    // SaaS Marketing
    '("saas marketing" OR "b2b saas" OR "indie maker" OR "founder") min_faves:3 lang:en -crypto',
];

// ─── Spam Filter (fast local pre-filter) ─────────────────────────────
const SPAM_KEYWORDS = [
    'crypto', 'btc', 'eth', 'nft', 'web3', 'airdrop', 'giveaway',
    'pump', 'token', 'presale', 'memecoin', 'solana', 'binance',
    'retweet to win', 'rt to', '100x', 'join our telegram'
];

function isSpam(text) {
    if (!text) return true;
    const lower = text.toLowerCase();
    return SPAM_KEYWORDS.some(kw => lower.includes(kw));
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

// ─── Telegram Helpers ────────────────────────────────────────────────
const telegramApi = (method, data) =>
    axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, data);

async function sendAggregatedTweets(tweets) {
    if (!tweets || tweets.length === 0) return;

    const lines = tweets.map((tweet, index) => {
        const author = tweet.author?.userName || tweet.user?.screen_name || 'unknown';
        const text = (tweet.text || tweet.full_text || '').replace(/\n/g, ' ');
        const url = tweet.url || (tweet.id ? `https://x.com/${author}/status/${tweet.id}` : 'https://x.com');
        const shortText = escapeHtml(text.substring(0, 150) + (text.length > 150 ? '...' : ''));
        const safeAuthor = escapeHtml(author);
        return `${index + 1}. <b>@${safeAuthor}</b> — <i>${shortText}</i>\n🔗 <a href="${url}">Open in X</a>`;
    });

    const header = `🚀 <b>New batch of tweets!</b>\n<i>${tweets.length} high-quality tweets ready to reply:</i>`;
    const message = [header, ...lines].join('\n\n');

    const inline_keyboard = [];
    for (let i = 0; i < tweets.length; i += 2) {
        const row = [];
        const addBtn = (idx) => {
            const t = tweets[idx];
            const tId = String(t.id || `${t.author?.userName}_${idx}`).substring(0, 30);
            row.push({ text: `${idx + 1} 👍`, callback_data: `good|${idx + 1}|${tId}` });
            row.push({ text: `${idx + 1} 👎`, callback_data: `bad|${idx + 1}|${tId}` });
        };
        addBtn(i);
        if (i + 1 < tweets.length) addBtn(i + 1);
        inline_keyboard.push(row);
    }

    try {
        await telegramApi('sendMessage', {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard }
        });
    } catch (error) {
        console.error('Error sending aggregated message:', error.response?.data || error.message);
    }
}

// ─── Collect Feedback from Telegram Button Clicks ────────────────────
async function collectFeedback(kvStore) {
    console.log('Collecting feedback from Telegram button clicks...');

    // Load persisted offset so we don't re-process old clicks
    const state = await loadFromKv(kvStore, 'telegram-offset', { offset: 0 });
    let offset = state.offset || 0;

    const feedbackLog = await loadFromKv(kvStore, FEEDBACK_KEY, []);
    let newFeedbackCount = 0;

    try {
        const res = await telegramApi('getUpdates', { offset, timeout: 0 });
        const updates = res.data?.result || [];

        for (const update of updates) {
            offset = update.update_id + 1; // advance offset past this update

            if (update.callback_query) {
                const cbData = update.callback_query.data;
                const parts = cbData.split('|');
                let rating = 'good';
                let indexStr = '1';
                let tweetId = 'unknown';

                if (parts.length === 3) {
                    [rating, indexStr, tweetId] = parts;
                } else if (parts.length === 2) {
                    [rating, tweetId] = parts;
                }

                const originalText = update.callback_query.message?.text || '';
                
                let tweetSnippet = '';
                const blocks = originalText.split('\n\n');
                const rawBlock = blocks.find(b => b.startsWith(`${indexStr}. `));
                
                if (rawBlock) {
                    tweetSnippet = rawBlock.substring(0, 200);
                } else {
                    tweetSnippet = originalText.substring(0, 150); // fallback
                }

                feedbackLog.push({
                    tweetId,
                    rating,
                    tweetSnippet,
                    timestamp: new Date().toISOString()
                });
                newFeedbackCount++;

                // Acknowledge the button press so Telegram stops showing a spinner
                try {
                    await telegramApi('answerCallbackQuery', {
                        callback_query_id: update.callback_query.id,
                        text: rating === 'good' ? '👍 Noted!' : '👎 Got it!'
                    });
                } catch { /* non-critical */ }
            }
        }
    } catch (error) {
        console.error('Error fetching Telegram updates:', error.response?.data || error.message);
    }

    if (newFeedbackCount > 0) {
        await saveToKv(kvStore, FEEDBACK_KEY, feedbackLog);
        console.log(`Saved ${newFeedbackCount} new feedback entries. Total history: ${feedbackLog.length}`);
    } else {
        console.log('No new feedback since last run.');
    }

    await saveToKv(kvStore, 'telegram-offset', { offset });
    return feedbackLog.length;
}

// ─── Gemini AI Scoring ───────────────────────────────────────────────
async function scoreTweetsWithAI(tweets, masterRules) {
    if (!masterRules || masterRules.trim() === '') {
        console.log('No master rules found yet. Skipping AI scoring, using all tweets.');
        return tweets; // No rules yet, pass everything through
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const tweetList = tweets.map((t, i) => {
        const text = t.text || t.full_text || '';
        const author = t.author?.userName || t.user?.screen_name || 'unknown';
        return `[${i}] @${author}: ${text.substring(0, 250)}`;
    }).join('\n\n');

    const prompt = `You are a tweet relevance filter for a tech founder.

Here are the founder's preference rules (learned from their feedback history):
---
${masterRules}
---

Below are ${tweets.length} tweets. For each tweet, output ONLY a JSON array of objects with "index" (integer) and "score" (integer 1-10, where 10 = most relevant per the rules above). Output NOTHING else, just the JSON array.

Tweets:
${tweetList}`;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Extract JSON array from the response (handle markdown code fences)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn('AI returned non-JSON response. Passing all tweets through.');
            return tweets;
        }

        const scores = JSON.parse(jsonMatch[0]);
        // Keep only tweets scoring 6 or above
        const goodIndices = scores
            .filter(s => s.score >= 6)
            .sort((a, b) => b.score - a.score)
            .map(s => s.index);

        const filtered = goodIndices
            .filter(i => i >= 0 && i < tweets.length)
            .map(i => tweets[i]);

        console.log(`AI scoring: ${tweets.length} tweets → ${filtered.length} passed (score ≥ 6).`);
        return filtered.length > 0 ? filtered : tweets.slice(0, 5); // fallback: send at least 5
    } catch (error) {
        console.error('Gemini AI scoring failed, passing all tweets:', error.message);
        return tweets;
    }
}

// ─── Main Execution ──────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  Twitter→Telegram Bot V2 — Starting Run');
    console.log('═══════════════════════════════════════════');

    if (!APIFY_TOKEN || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !GEMINI_API_KEY) {
        console.error('Missing required environment variables. Need: APIFY_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY');
        process.exit(1);
    }

    const kvStore = await getOrCreateKvStore();

    // ── Step 1: Collect any feedback from Telegram buttons ──
    await collectFeedback(kvStore);

    // ── Step 2: Pick a random topic query ──
    const searchQuery = TOPIC_QUERIES[Math.floor(Math.random() * TOPIC_QUERIES.length)];
    console.log(`🔍 Query: ${searchQuery}`);

    // ── Step 3: Scrape tweets via Apify ──
    try {
        const runInput = {
            searchTerms: [searchQuery],
            searchMode: 'live',
            maxItems: MAX_TWEETS_PER_FETCH
        };

        console.log(`Calling Apify Actor ${ACTOR_ID}...`);
        const run = await apifyClient.actor(ACTOR_ID).call(runInput);
        console.log(`Actor finished. Run ID: ${run.id}`);

        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({
            limit: MAX_TWEETS_PER_FETCH
        });
        console.log(`Fetched ${items.length} tweets from Apify.`);

        // ── Step 4: Local pre-filter (fast spam removal) ──
        const cleanTweets = items.filter(tweet => {
            const text = tweet.text || tweet.full_text || '';
            return !isSpam(text);
        });
        console.log(`After spam filter: ${cleanTweets.length} tweets remain.`);

        if (cleanTweets.length === 0) {
            console.log('No valid tweets after spam filtering. Exiting.');
            return;
        }

        // ── Step 5: AI scoring using Master Rules ──
        const masterRules = await loadFromKv(kvStore, RULES_KEY, '');
        const scoredTweets = await scoreTweetsWithAI(cleanTweets, masterRules);

        // Cap at MAX_TWEETS_FOR_TELEGRAM
        const finalTweets = scoredTweets.slice(0, MAX_TWEETS_FOR_TELEGRAM);

        // ── Step 6: Send Aggregate to Telegram ──
        await sendAggregatedTweets(finalTweets);
        console.log(`✅ Aggregated message sent to Telegram successfully.`);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

main();
