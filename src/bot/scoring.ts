import { GoogleGenerativeAI } from "@google/generative-ai"

import { getTweetAuthor, getTweetText } from "../lib/tweet"
import type { TweetRecord } from "../types/domain"

export async function scoreTweetsWithAI(
    genAI: GoogleGenerativeAI,
    tweets: TweetRecord[],
    masterRules: string
): Promise<TweetRecord[]> {
    if (!masterRules || masterRules.trim() === "") {
        console.log("No master rules found yet. Skipping AI scoring, using all tweets.")
        return tweets
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    const tweetList = tweets
        .map((tweet, index) => `[${index}] @${getTweetAuthor(tweet)}: ${getTweetText(tweet).substring(0, 250)}`)
        .join("\n\n")

    const prompt = `You are a tweet relevance filter for a tech founder. Here are the founder's preference rules (learned from their feedback history):
    ---
    ${masterRules}
    ---
    Below are ${tweets.length} tweets. For each tweet, output ONLY a JSON array of objects with "index" (integer) and "score" (integer 1-10, where 10 = most relevant per the rules above). Output NOTHING else, just the JSON array.
    Tweets:
    ${tweetList}`

    try {
        const result = await model.generateContent(prompt)
        const responseText = result.response.text()
        const jsonMatch = responseText.match(/\[[\s\S]*\]/)

        if (!jsonMatch) {
            console.warn("AI returned non-JSON response. Passing all tweets through.")
            return tweets
        }

        const scores = JSON.parse(jsonMatch[0]) as Array<{ index: number; score: number }>
        const goodIndices = scores
            .filter((score) => score.score >= 6)
            .sort((a, b) => b.score - a.score)
            .map((score) => score.index)

        const filtered = goodIndices
            .filter((index) => index >= 0 && index < tweets.length)
            .map((index) => tweets[index])

        console.log(`AI scoring: ${tweets.length} tweets -> ${filtered.length} passed (score >= 6).`)
        return filtered.length > 0 ? filtered : tweets.slice(0, 5)
    } catch (error: any) {
        console.error("Gemini AI scoring failed, passing all tweets:", error?.message || error)
        return tweets
    }
}
