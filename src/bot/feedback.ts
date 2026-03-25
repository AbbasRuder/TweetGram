import type { FeedbackEntry, FeedbackRating, TelegramOffsetState } from "../types/domain"
import { FEEDBACK_KEY, TELEGRAM_OFFSET_KEY } from "../config/constants"
import { loadFromKv, saveJsonToKv } from "../lib/kvStore"

interface CallbackPayload {
    rating: FeedbackRating
    index: number
    tweetId: string
}

interface TelegramClientForFeedback {
    getUpdates: (offset: number) => Promise<
        Array<{
            update_id: number
            callback_query?: {
                id: string
                data?: string
                message?: { text?: string }
            }
        }>
    >
    answerCallbackQuery: (callbackQueryId: string, rating: FeedbackRating) => Promise<void>
}

function parseFeedbackCallbackData(callbackData = ""): CallbackPayload {
    const [rawRating, rawIndex, rawTweetId] = callbackData.split("|")
    const rating: FeedbackRating = rawRating === "bad" ? "bad" : "good"
    const index = Number.parseInt(rawIndex, 10)

    return {
        rating,
        index: Number.isFinite(index) && index > 0 ? index : 1,
        tweetId: rawTweetId || "unknown",
    }
}

function getTweetSnippetFromMessage(messageText = "", index = 1): string {
    if (!messageText) return ""

    const blocks = messageText.split("\n\n")
    const indexedPrefix = `${index}. `
    const matchingBlock = blocks.find((block) => block.startsWith(indexedPrefix))
    const snippetSource = matchingBlock || messageText

    return snippetSource.substring(0, 200)
}

async function appendFeedbackEntries(kvStore: any, newEntries: FeedbackEntry[]): Promise<number> {
    if (!newEntries.length) return 0

    const existingFeedback = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
    const safeExisting = Array.isArray(existingFeedback) ? existingFeedback : []

    const existingEventIds = new Set(safeExisting.map((entry) => entry.eventId).filter(Boolean))

    const dedupedNewEntries = newEntries.filter((entry) => {
        if (!entry.eventId) return true
        if (existingEventIds.has(entry.eventId)) return false
        existingEventIds.add(entry.eventId)
        return true
    })

    await saveJsonToKv(kvStore, FEEDBACK_KEY, [...safeExisting, ...dedupedNewEntries])
    return dedupedNewEntries.length
}

export async function collectFeedback(kvStore: any, telegramClient: TelegramClientForFeedback): Promise<number> {
    console.log("Collecting feedback from Telegram button clicks...")

    const state = await loadFromKv<TelegramOffsetState>(kvStore, TELEGRAM_OFFSET_KEY, { offset: 0 })
    let offset = state.offset || 0
    const pendingEntries: FeedbackEntry[] = []

    try {
        const updates = await telegramClient.getUpdates(offset)

        for (const update of updates) {
            offset = update.update_id + 1
            if (!update.callback_query) continue

            const callbackData = update.callback_query.data || ""
            const { rating, index, tweetId } = parseFeedbackCallbackData(callbackData)
            const originalText = update.callback_query.message?.text || ""
            const tweetSnippet = getTweetSnippetFromMessage(originalText, index)

            pendingEntries.push({
                eventId: update.callback_query.id,
                updateId: update.update_id,
                tweetId,
                rating,
                tweetSnippet,
                timestamp: new Date().toISOString(),
            })

            try {
                await telegramClient.answerCallbackQuery(update.callback_query.id, rating)
            } catch {
                // non-critical ack failure
            }
        }
    } catch (error: any) {
        console.error("Error fetching Telegram updates:", error?.response?.data || error?.message || error)
    }

    const appendedCount = await appendFeedbackEntries(kvStore, pendingEntries)

    if (appendedCount > 0) {
        const latestFeedback = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
        const totalHistory = Array.isArray(latestFeedback) ? latestFeedback.length : 0
        console.log(`Saved ${appendedCount} new feedback entries. Total history: ${totalHistory}`)
    } else {
        console.log("No new feedback since last run.")
    }

    await saveJsonToKv(kvStore, TELEGRAM_OFFSET_KEY, { offset })

    const currentFeedback = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
    return Array.isArray(currentFeedback) ? currentFeedback.length : 0
}
