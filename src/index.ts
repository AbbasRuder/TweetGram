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
        timeout: 30000 // 30 second timeout for AI calls
    })
    const telegramClient = createTelegramClient({
        botToken: env.telegramBotToken!,
        chatId: env.telegramChatId!,
    })
    const kvStore = await getOrCreateKvStore(apifyClient)

    const query = pickRandomQuery()
    console.log(`[Scraper] Using query: ${query}`)

    let rawTweets: TweetRecord[] = []
    try {
        rawTweets = await fetchTweets(apifyClient, env.actorId, query)
    } catch (error: any) {
        console.error("[Scraper Error] Failed to fetch tweets from Apify:", error.message)
        return
    }

    const cleanTweets = filterTweets(rawTweets)
    if (cleanTweets.length === 0) {
        console.log("[Bot] No valid tweets after spam filtering. Exiting.")
        return
    }

    console.log(`[Bot] ${cleanTweets.length} tweets ready for scoring.`)

    const masterRules = await loadFromKv<string>(kvStore, RULES_KEY, "")
    const scoredTweets = await scoreTweetsWithAI(openai, cleanTweets, masterRules)
    const finalTweets = scoredTweets.slice(0, MAX_TWEETS_FOR_TELEGRAM)

    if (finalTweets.length === 0) {
        console.log("[Bot] No tweets passed the AI scoring threshold. Skipping Telegram update.")
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
