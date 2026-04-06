import { ApifyClient } from "apify-client"
import OpenAI from "openai"

process.env.APIFY_LOG_LEVEL = 'error';

import { MAX_TWEETS_FOR_TELEGRAM, MAX_TWEETS_PER_FETCH, RULES_KEY, TOPIC_QUERIES } from "./config/constants"
import { assertBotEnv, getEnv } from "./config/env"
import { getOrCreateKvStore, loadFromKv } from "./lib/kvStore"
import { createTelegramClient } from "./lib/telegram"
import { getTweetText, isMainOrParentTweet, isSpam } from "./lib/tweet"
import { scoreTweetsWithAI } from "./bot/scoring"
import type { TweetRecord } from "./types/domain"

function pickRandomQuery(): string {
    return TOPIC_QUERIES[Math.floor(Math.random() * TOPIC_QUERIES.length)]
}

async function fetchTweets(apifyClient: ApifyClient, actorId: string, query: string): Promise<TweetRecord[]> {
    const runInput = {
        searchTerms: [query],
        searchMode: "live",
        maxItems: MAX_TWEETS_PER_FETCH,
    }

    console.log(`Calling Apify Actor ${actorId}...`)
    const run = await apifyClient.actor(actorId).call(runInput)
    console.log(`Actor finished. Run ID: ${run.id}`)

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({
        limit: MAX_TWEETS_PER_FETCH,
    })

    console.log(`Fetched ${items.length} tweets from Apify.`)
    return items as TweetRecord[]
}

function filterTweets(rawTweets: TweetRecord[]): TweetRecord[] {
    const mainTweets = rawTweets.filter(isMainOrParentTweet)
    console.log(`After main/parent filter: ${mainTweets.length} tweets remain.`)

    const cleanTweets = mainTweets.filter((tweet) => !isSpam(getTweetText(tweet)))
    console.log(`After spam filter: ${cleanTweets.length} tweets remain.`)

    return cleanTweets
}

async function runBot(): Promise<void> {
    const startRun = Date.now()
    console.log("===========================================")
    console.log("  Twitter to Telegram Bot - Starting Run")
    console.log("===========================================")

    const env = getEnv()
    try {
        assertBotEnv(env)
    } catch (e: any) {
        console.error("[Config Error] Environment check failed:", e.message)
        process.exit(1)
    }

    const apifyClient = new ApifyClient({ token: env.apifyToken })
    const openai = new OpenAI({ 
        apiKey: env.nvidiaApiKey, 
        baseURL: 'https://integrate.api.nvidia.com/v1',
        timeout: 180000 // 180 second timeout (3 minutes)
    })
    const telegramClient = createTelegramClient({
        botToken: env.telegramBotToken!,
        chatId: env.telegramChatId!,
    })
    const kvStore = await getOrCreateKvStore(apifyClient)
    const masterRules = await loadFromKv<string>(kvStore, RULES_KEY, "")

    let accumulatedTweets: TweetRecord[] = []
    const seenIds = new Set<string>()

    // Shuffle and pick unique queries for each iteration
    const queryPool = [...TOPIC_QUERIES].sort(() => Math.random() - 0.5)
    const MAX_ITERATIONS = Math.min(3, queryPool.length)
    const TARGET_COUNT = MAX_TWEETS_FOR_TELEGRAM

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const iterationNum = i + 1
        console.log(`[Bot] Iteration ${iterationNum}/${MAX_ITERATIONS} (Target: ${TARGET_COUNT}, Current: ${accumulatedTweets.length})`)
        
        const query = queryPool[i]
        console.log(`[Scraper] Using query: ${query}`)

        let rawTweets: TweetRecord[] = []
        try {
            rawTweets = await fetchTweets(apifyClient, env.actorId, query)
        } catch (error: any) {
            console.error(`[Scraper Error] Failed to fetch tweets in iteration ${iterationNum}:`, error.message)
            continue
        }

        const cleanTweets = filterTweets(rawTweets)
        if (cleanTweets.length === 0) {
            console.log(`[Bot] No valid tweets in iteration ${iterationNum} after filtering.`)
            continue
        }

        const scoredTweets = await scoreTweetsWithAI(openai, cleanTweets, masterRules)
        
        let newCount = 0
        for (const tweet of scoredTweets) {
            const id = String(tweet.id || "")
            if (id && !seenIds.has(id)) {
                seenIds.add(id)
                accumulatedTweets.push(tweet)
                newCount++
            }
        }

        console.log(`[Bot] Iteration ${iterationNum} added ${newCount} new unique tweets.`)

        if (accumulatedTweets.length >= TARGET_COUNT) {
            console.log(`[Bot] Reached target of ${TARGET_COUNT} tweets. Stopping search.`)
            break
        }
    }

    const finalTweets = accumulatedTweets.slice(0, TARGET_COUNT)

    if (finalTweets.length === 0) {
        console.log("[Bot] No tweets passed the AI scoring threshold after all iterations. Exiting.")
        return
    }

    try {
        await telegramClient.sendFeedbackBatch(finalTweets)
        console.log(`[Bot] Successfully sent ${finalTweets.length} tweets to Telegram.`)
    } catch (error: any) {
        console.error("[Telegram Error] Failed to send tweet batch:", error.message)
    }

    const duration = ((Date.now() - startRun) / 1000).toFixed(1)
    console.log(`===========================================`)
    console.log(`  Bot Run Finished in ${duration}s`)
    console.log(`===========================================`)
}

runBot().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
})
