import { ApifyClient } from "apify-client"
import OpenAI from "openai"

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

    const MAX_ITERATIONS = 3
    const TARGET_COUNT = MAX_TWEETS_FOR_TELEGRAM

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
        console.log(`[Bot] Iteration ${i}/${MAX_ITERATIONS} (Target: ${TARGET_COUNT}, Current: ${accumulatedTweets.length})`)
        
        const query = pickRandomQuery()
        console.log(`[Scraper] Using query: ${query}`)

        let rawTweets: TweetRecord[] = []
        try {
            rawTweets = await fetchTweets(apifyClient, env.actorId, query)
        } catch (error: any) {
            console.error(`[Scraper Error] Failed to fetch tweets in iteration ${i}:`, error.message)
            continue
        }

        const cleanTweets = filterTweets(rawTweets)
        if (cleanTweets.length === 0) {
            console.log(`[Bot] No valid tweets in iteration ${i} after spam filtering.`)
            continue
        }

        const scoredTweets = await scoreTweetsWithAI(openai, cleanTweets, masterRules)
        
        for (const tweet of scoredTweets) {
            const id = String(tweet.id || "")
            if (id && !seenIds.has(id)) {
                seenIds.add(id)
                accumulatedTweets.push(tweet)
            }
        }

        if (accumulatedTweets.length >= TARGET_COUNT) {
            console.log(`[Bot] Reached target of ${TARGET_COUNT} tweets. Stopping search.`)
            break
        }

        if (i < MAX_ITERATIONS) {
            console.log(`[Bot] Only ${accumulatedTweets.length} tweets found. Starting next iteration...`)
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
