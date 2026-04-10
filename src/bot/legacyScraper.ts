import { ApifyClient } from "apify-client"
import OpenAI from "openai"
import { MAX_TWEETS_FOR_TELEGRAM, MAX_TWEETS_PER_FETCH, RULES_KEY, TOPIC_QUERIES } from "../config/constants"
import { getOrCreateKvStore, loadFromKv } from "../lib/kvStore"
import { createTelegramClient } from "../lib/telegram"
import { getTweetText, isMainOrParentTweet, isSpam } from "../lib/tweet"
import { scoreTweetsWithAI } from "./scoring"
import type { TweetRecord } from "../types/domain"
import type { AppEnv } from "../config/env"

async function fetchTweets(apifyClient: ApifyClient, actorId: string, query: string): Promise<TweetRecord[]> {
    const runInput = {
        searchTerms: [query],
        searchMode: "live",
        maxItems: MAX_TWEETS_PER_FETCH,
    }

    console.log(`[Legacy Scraper] Calling Apify Actor ${actorId}...`)
    const run = await apifyClient.actor(actorId).start(runInput)
    await apifyClient.run(run.id).waitForFinish()
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({
        limit: MAX_TWEETS_PER_FETCH,
    })

    return items as TweetRecord[]
}

function filterTweets(rawTweets: TweetRecord[]): TweetRecord[] {
    const mainTweets = rawTweets.filter(isMainOrParentTweet)
    const cleanTweets = mainTweets.filter((tweet) => !isSpam(getTweetText(tweet)))
    return cleanTweets
}

export async function runLegacyBot(env: AppEnv): Promise<void> {
    const startRun = Date.now()
    console.log("[Legacy Bot] Starting topic-based search...")

    const apifyClient = new ApifyClient({ token: env.apifyToken })
    const openai = new OpenAI({ 
        apiKey: env.nvidiaApiKey, 
        baseURL: 'https://integrate.api.nvidia.com/v1'
    })
    const telegramClient = createTelegramClient({
        botToken: env.telegramBotToken!,
        chatId: env.telegramChatId!,
    })
    const kvStore = await getOrCreateKvStore(apifyClient)
    const masterRules = await loadFromKv<string>(kvStore, RULES_KEY, "")

    let accumulatedTweets: TweetRecord[] = []
    const seenIds = new Set<string>()

    const queryPool = [...TOPIC_QUERIES].sort(() => Math.random() - 0.5)
    const MAX_ITERATIONS = Math.min(3, queryPool.length)
    const TARGET_COUNT = MAX_TWEETS_FOR_TELEGRAM

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const query = queryPool[i]
        let rawTweets: TweetRecord[] = []
        try {
            rawTweets = await fetchTweets(apifyClient, env.actorId, query)
        } catch (error: any) {
            continue
        }

        const cleanTweets = filterTweets(rawTweets)
        const scoredTweets = await scoreTweetsWithAI(openai, cleanTweets, masterRules)
        
        for (const tweet of scoredTweets) {
            const id = String(tweet.id || "")
            if (id && !seenIds.has(id)) {
                seenIds.add(id)
                accumulatedTweets.push(tweet)
            }
        }

        if (accumulatedTweets.length >= TARGET_COUNT) break
    }

    const finalTweets = accumulatedTweets.slice(0, TARGET_COUNT)
    if (finalTweets.length > 0) {
        await telegramClient.sendFeedbackBatch(finalTweets)
    }

    console.log(`[Legacy Bot] Finished in ${((Date.now() - startRun) / 1000).toFixed(1)}s`)
}
