import { ApifyClient } from "apify-client"
import { MAX_TWEETS_FOR_TELEGRAM, SEEN_TWEETS_KEY, TARGET_LIST_ID, FALLBACK_COMMUNITY_QUERY, RUN_COUNT_KEY, USER_HANDLE } from "../config/constants"
import { getOrCreateKvStore, loadFromKv, saveJsonToKv } from "../lib/kvStore"
import { createTelegramClient } from "../lib/telegram"
import { getTweetText, isMainOrParentTweet, isSpam } from "../lib/tweet"
import type { TweetRecord } from "../types/domain"
import type { AppEnv } from "../config/env"

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

async function fetchTweetsFromList(apifyClient: ApifyClient, actorId: string, listId: string): Promise<TweetRecord[]> {
    console.log(`[List Scraper] Fetching from Twitter List: ${listId} using ${actorId}`);
    const runInput = {
        twitterContent: `list:${listId}`,
        searchMode: "live",
        maxItems: 100, // Fetch more from list to ensure we get fresh ones after filtering
    };
    try {
        const run = await apifyClient.actor(actorId).start(runInput);
        await apifyClient.run(run.id).waitForFinish();
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 100 });
        return items as TweetRecord[];
    } catch (error: any) {
        console.error(`[List Scraper] Failed to fetch list: ${error.message}`);
        return [];
    }
}

async function fetchTweetsFromSearch(apifyClient: ApifyClient, actorId: string, query: string): Promise<TweetRecord[]> {
    console.log(`[Search Scraper] Fetching fallback community tweets: "${query}"`);
    const runInput = {
        twitterContent: query,
        searchMode: "live",
        maxItems: 50,
    };
    try {
        const run = await apifyClient.actor(actorId).start(runInput);
        await apifyClient.run(run.id).waitForFinish();
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 50 });
        return items as TweetRecord[];
    } catch (error: any) {
        console.error(`[Search Scraper] Failed to fetch search: ${error.message}`);
        return [];
    }
}

async function fetchDailyStats(apifyClient: ApifyClient, actorId: string, handle: string): Promise<{ replyCount: number; totalUsd: number }> {
    console.log(`[Stats] Fetching daily stats for @${handle}...`);
    
    // 1. Fetch replies today
    const today = new Date().toISOString().split('T')[0];
    const query = `from:${handle} filter:replies since:${today}`;
    
    let replyCount = 0;
    try {
        const runInput = {
            twitterContent: query,
            searchMode: "live",
            maxItems: 50,
        };
        const run = await apifyClient.actor(actorId).start(runInput);
        await apifyClient.run(run.id).waitForFinish();
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 50 });
        replyCount = items.length;
    } catch (error: any) {
        console.error(`[Stats] Failed to fetch reply count: ${error.message}`);
    }

    // 2. Fetch Apify spend
    let totalUsd = 0;
    try {
        const usage: any = await apifyClient.user().monthlyUsage();
        totalUsd = usage.totalUsd || 0;
    } catch (error: any) {
        console.error(`[Stats] Failed to fetch Apify usage: ${error.message}`);
    }

    return { replyCount, totalUsd };
}

function processAndFilterTweets(rawTweets: TweetRecord[], seenSet: Set<string>, now: number): TweetRecord[] {
    return rawTweets
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
            return dateB - dateA;
        });
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

    const listId = TARGET_LIST_ID;
    const seenIds = await loadFromKv<string[]>(kvStore, SEEN_TWEETS_KEY, []);
    const seenSet = new Set(seenIds);
    const now = Date.now();

    // Track bot run count for stats frequency
    const runCount = await loadFromKv<number>(kvStore, RUN_COUNT_KEY, 0);
    const currentRun = runCount + 1;
    const shouldTrackStats = currentRun % 2 === 0;

    // 1. Fetch from static list
    const rawListTweets = await fetchTweetsFromList(apifyClient, env.actorId, listId);
    let filteredTweets = processAndFilterTweets(rawListTweets, seenSet, now);
    console.log(`[Bot] Found ${filteredTweets.length} fresh tweets from list.`);

    // 2. Fallback to community search if needed
    if (filteredTweets.length < MAX_TWEETS_FOR_TELEGRAM) {
        const needed = MAX_TWEETS_FOR_TELEGRAM - filteredTweets.length;
        console.log(`[Bot] Need ${needed} more tweets. Running fallback search...`);
        
        const rawSearchTweets = await fetchTweetsFromSearch(apifyClient, env.actorId, FALLBACK_COMMUNITY_QUERY);
        
        // Add current list IDs to seenSet temporarily to avoid duplicates in the same batch
        const currentBatchIds = new Set(filteredTweets.map(t => String(t.id || t.tweetId || "")));
        const combinedSeenSet = new Set([...seenSet, ...currentBatchIds]);

        const filteredSearchTweets = processAndFilterTweets(rawSearchTweets, combinedSeenSet, now);
        console.log(`[Bot] Found ${filteredSearchTweets.length} fresh fallback tweets.`);

        filteredTweets = [...filteredTweets, ...filteredSearchTweets];
    }

    const finalTweets = filteredTweets.slice(0, MAX_TWEETS_FOR_TELEGRAM);

    // 3. Optional Stats Tracking
    let statsMessage = "";
    if (shouldTrackStats) {
        const stats = await fetchDailyStats(apifyClient, env.actorId, USER_HANDLE);
        statsMessage = `📊 <b>Daily Stats:</b>\n- You have sent ${stats.replyCount >= 50 ? '50+' : stats.replyCount} replies today!\n- Current Apify Spend: $${stats.totalUsd.toFixed(2)}`;
    }

    if (finalTweets.length === 0) {
        console.log("[Bot] No new tweets found from any source.");
        if (statsMessage) {
            await telegramClient.sendMessage(env.telegramChatId!, statsMessage);
        }
    } else {
        // 4. Send Tweets to Telegram
        try {
            await telegramClient.sendFeedbackBatch(finalTweets);
            console.log(`[Bot] Successfully sent ${finalTweets.length} tweets to Telegram.`);

            if (statsMessage) {
                await telegramClient.sendMessage(env.telegramChatId!, statsMessage);
            }

            // 5. Update Seen IDs
            const newIds = finalTweets.map(t => String(t.id || t.tweetId || ""));
            const updatedSeenIds = [...newIds, ...seenIds].slice(0, 1000);
            await saveJsonToKv(kvStore, SEEN_TWEETS_KEY, updatedSeenIds);
        } catch (error: any) {
            console.error("[Telegram Error] Failed to send tweet batch:", error.message);
        }
    }

    // Update run count
    await saveJsonToKv(kvStore, RUN_COUNT_KEY, currentRun);

    const duration = ((Date.now() - startRun) / 1000).toFixed(1);
    console.log(`===========================================`);
    console.log(`  Bot Run Finished in ${duration}s`);
    console.log(`===========================================`);
}
