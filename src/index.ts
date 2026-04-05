import { ApifyClient } from "apify-client"
import { GoogleGenerativeAI } from "@google/generative-ai"

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
    console.log("===========================================")
    console.log("  Twitter to Telegram Bot - Starting Run")
    console.log("===========================================")

    const env = getEnv()
    assertBotEnv(env)

    const apifyClient = new ApifyClient({ token: env.apifyToken })
    const genAI = new GoogleGenerativeAI(env.geminiApiKey)
    const telegramClient = createTelegramClient({
        botToken: env.telegramBotToken!,
        chatId: env.telegramChatId!,
    })
    const kvStore = await getOrCreateKvStore(apifyClient)

    const query = pickRandomQuery()
    console.log(`Query: ${query}`)

    const rawTweets = await fetchTweets(apifyClient, env.actorId, query)
    const cleanTweets = filterTweets(rawTweets)

    if (cleanTweets.length === 0) {
        console.log("No valid tweets after spam filtering. Exiting.")
        return
    }

    const masterRules = await loadFromKv<string>(kvStore, RULES_KEY, "")
    const scoredTweets = await scoreTweetsWithAI(genAI, cleanTweets, masterRules)
    const finalTweets = scoredTweets.slice(0, MAX_TWEETS_FOR_TELEGRAM)

    await telegramClient.sendFeedbackBatch(finalTweets)

    console.log("Tweet batch sent to Telegram successfully.")
}

runBot().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
})
