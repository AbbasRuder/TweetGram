import OpenAI from "openai"

import { getTweetAuthor, getTweetText } from "../lib/tweet"
import type { TweetRecord } from "../types/domain"

export async function scoreTweetsWithAI(
    openai: OpenAI,
    tweets: TweetRecord[],
    masterRules: string
): Promise<TweetRecord[]> {
    if (!masterRules || masterRules.trim() === "") {
        console.log("No master rules found yet. Skipping AI scoring, using all tweets.")
        return tweets
    }

    const tweetList = tweets
        .map((tweet, index) => `[${index}] @${getTweetAuthor(tweet)}: ${getTweetText(tweet).substring(0, 800)}`)
        .join("\n\n")

    const prompt = `You are a tweet relevance filter for a tech founder. Here are the founder's preference rules (learned from their feedback history):
    ---
    ${masterRules}
    ---
    Below are ${tweets.length} tweets. For each tweet, output ONLY a JSON array of objects with "index" (integer) and "score" (integer 1-10, where 10 = most relevant per the rules above). Output NOTHING else, just the JSON array.
    Tweets:
    ${tweetList}`

    try {
        console.log(`[AI Scoring] Calling NVIDIA API (deepseek-ai/deepseek-v3.2) for ${tweets.length} tweets...`)
        const completion = await openai.chat.completions.create({
            model: "deepseek-ai/deepseek-v3.2",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 1024,
        })

        const responseText = completion.choices[0]?.message?.content || ""
        console.log(`[AI Scoring] Received response (${responseText.length} chars).`)
        
        const jsonMatch = responseText.match(/\[[\s\S]*\]/)
        if (!jsonMatch) {
            console.warn("[AI Scoring] AI returned non-JSON response format. Skipping this batch for safety.")
            console.log("[AI Scoring] Raw response:", responseText.substring(0, 500))
            return tweets.slice(0, 5) // Return small sample as fallback
        }

        let scores: Array<{ index: number; score: number }> = []
        try {
            scores = JSON.parse(jsonMatch[0])
        } catch (pe: any) {
            console.error("[AI Scoring] Failed to parse AI JSON response:", pe?.message || "Unknown parsing error")
            return tweets.slice(0, 5)
        }
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
        console.error("AI scoring failed, passing all tweets:", error?.message || error)
        return tweets
    }
}
