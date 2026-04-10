import { ApifyClient } from "apify-client"
import { MAX_TWEETS_FOR_TELEGRAM, SEEN_TWEETS_KEY, TARGET_LIST_ID } from "../config/constants"
import { getOrCreateKvStore, loadFromKv, saveJsonToKv } from "../lib/kvStore"
import { createTelegramClient } from "../lib/telegram"
import { getTweetText, isMainOrParentTweet, isSpam } from "../lib/tweet"
import type { TweetRecord } from "../types/domain"
import type { AppEnv } from "../config/env"

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

async function fetchTweetsFromList(apifyClient: ApifyClient, actorId: string, listId: string): Promise<TweetRecord[]> {
    console.log(`[List Scraper] Fetching from Twitter List: ${listId} using ${actorId}`);
    
    // Updated input for xquik/twitter-scraper
    const runInput = {
        twitterContent: `list:${listId}`,
        searchMode: "live",
        maxItems: 100, // Fetch more from list to ensure we get fresh ones after filtering
    };

    try {
        const run = await apifyClient.actor(actorId).start(runInput);
        await apifyClient.run(run.id).waitForFinish();
        
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({
            limit: 100,
        });
        return items as TweetRecord[];
    } catch (error: any) {
        console.error(`[List Scraper] Failed to fetch list: ${error.message}`);
        return [];
    }
}

export async function runAccountBot(env: AppEnv): Promise<void> {
    const startRun = Date.now();
    console.log("===========================================");
    console.log("  Twitter List-Based Bot - Starting Run");
    console.log("===========================================");

    const apifyClient = new ApifyClient({ token: env.apifyToken });
    const telegramClient = createTelegramClient({
        botToken: env.telegramBotToken!,
        chatId: env.telegramChatId!,
    });
    const kvStore = await getOrCreateKvStore(apifyClient);

    // 1. Load Target List ID (Use static ID directly)
    const listId = TARGET_LIST_ID;
    console.log(`[List Scraper] Using static List ID: ${listId}`);

    // 2. Load Seen IDs for cross-run deduplication
    const seenIds = await loadFromKv<string[]>(kvStore, SEEN_TWEETS_KEY, []);
    const seenSet = new Set(seenIds);

    // 3. Fetch Tweets
    const rawTweets = await fetchTweetsFromList(apifyClient, env.actorId, listId);
    console.log(`[List Scraper] Fetched ${rawTweets.length} total raw tweets from list.`);

    // 4. Filter & Sort
    const now = Date.now();
    const filteredTweets = rawTweets
        .filter(isMainOrParentTweet)
        .filter(tweet => !isSpam(getTweetText(tweet)))
        .filter(tweet => {
            const id = String(tweet.id || tweet.tweetId || "");
            return id && !seenSet.has(id);
        })
        .filter(tweet => {
            if (!tweet.createdAt) return false;
            const createdDate = new Date(tweet.createdAt).getTime();
            return (now - createdDate) < FIVE_HOURS_MS;
        })
        .sort((a, b) => {
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA; // Latest first
        });

    console.log(`[List Scraper] ${filteredTweets.length} tweets remaining after filtering/sorting.`);

    const finalTweets = filteredTweets.slice(0, MAX_TWEETS_FOR_TELEGRAM);

    if (finalTweets.length === 0) {
        console.log("[List Scraper] No new tweets found in the last 5 hours.");
        return;
    }

    // 5. Send to Telegram
    try {
        await telegramClient.sendFeedbackBatch(finalTweets);
        console.log(`[List Scraper] Successfully sent ${finalTweets.length} tweets to Telegram.`);

        // 6. Update Seen IDs
        const newIds = finalTweets.map(t => String(t.id || t.tweetId || ""));
        const updatedSeenIds = [...newIds, ...seenIds].slice(0, 1000); // Keep last 1000
        await saveJsonToKv(kvStore, SEEN_TWEETS_KEY, updatedSeenIds);
        console.log(`[List Scraper] Updated seen IDs list.`);
    } catch (error: any) {
        console.error("[Telegram Error] Failed to send tweet batch:", error.message);
    }

    const duration = ((Date.now() - startRun) / 1000).toFixed(1);
    console.log(`===========================================`);
    console.log(`  List Bot Run Finished in ${duration}s`);
    console.log(`===========================================`);
}
