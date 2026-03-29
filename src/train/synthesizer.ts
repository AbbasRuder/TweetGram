import { GoogleGenerativeAI } from "@google/generative-ai"

import type { FeedbackEntry } from "../types/domain"

function formatEntries(entries: FeedbackEntry[], label: string): string {
    if (entries.length === 0) return `No ${label} tweets yet.`
    return entries.map((entry, index) => `${index + 1}. ${entry.tweetSnippet}`).join("\n")
}

export async function synthesizeMasterRules(
    genAI: GoogleGenerativeAI,
    feedbackLog: FeedbackEntry[],
    existingRules: string
): Promise<string> {
    const liked = feedbackLog.filter((entry) => entry.rating === "good")
    const disliked = feedbackLog.filter((entry) => entry.rating === "bad")

    console.log(`Liked: ${liked.length} | Disliked: ${disliked.length}`)

    const likedText = formatEntries(liked, "liked")
    const dislikedText = formatEntries(disliked, "disliked")

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    const prompt = `You are an expert at analyzing user preferences from examples.

A tech founder has been rating tweets as "Good" (worth replying to) or "Bad" (not interesting).
Your job is to analyze ALL of their historical feedback below and produce a comprehensive, strict RULESET that describes exactly what types of tweets this person wants to see vs. what they want filtered out.

${existingRules ? `Here are the PREVIOUS rules (use as a starting point, but update or override based on the new data below):\n---\n${existingRules}\n---\n` : ""}

=== TWEETS THE USER LIKED (${liked.length} total) ===
${likedText}

=== TWEETS THE USER DISLIKED (${disliked.length} total) ===
${dislikedText}

Now produce a MASTER RULESET as a clear bulleted list. Include:
1. MUST INCLUDE rules - Topics, themes, keywords, and tweet styles the user actively engages with.
2. MUST EXCLUDE rules - Topics, themes, keywords, and tweet styles the user dislikes.
3. QUALITY SIGNALS - Patterns that indicate a tweet is high-quality vs. low-quality for this user.
4. TONE PREFERENCES - Whether the user prefers conversational tweets, hot takes, technical deep dives, questions, etc.

Be very specific and data-driven. Reference concrete examples from their feedback where possible.
Output ONLY the ruleset, nothing else.`

    const result = await model.generateContent(prompt)
    return result.response.text()
}
