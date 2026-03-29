import { ACTIVE_BATCH_KEY, FEEDBACK_KEY, TELEGRAM_OFFSET_KEY } from "../config/constants"
import { loadFromKv, saveJsonToKv } from "../lib/kvStore"
import { getTweetId, getTweetText } from "../lib/tweet"
import type {
    ActiveFeedbackBatch,
    FeedbackEntry,
    FeedbackRating,
    PromptReplyState,
    SentFeedbackBatch,
    TelegramOffsetState,
    TweetRecord
} from "../types/domain"

type PromptKind = "like" | "dislike"

interface TelegramMessageUpdate {
    update_id: number
    message?: {
        message_id: number
        text?: string
        date?: number
        chat?: { id: number | string }
        reply_to_message?: { message_id: number }
    }
}

interface TelegramClientForFeedback {
    getUpdates: (offset: number, limit?: number, allowed_updates?: string[]) => Promise<TelegramMessageUpdate[]>
}

function normalizeSnippet(text = ""): string {
    return text.replace(/\s+/g, " ").trim().substring(0, 200)
}

function buildPromptReplyState(update: TelegramMessageUpdate): PromptReplyState | null {
    const message = update.message
    if (!message) return null

    return {
        updateId: update.update_id,
        messageId: message.message_id,
        text: (message.text || "").trim(),
        timestamp: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
    }
}

function getFeedbackDedupKey(entry: FeedbackEntry): string {
    if (entry.updateId !== undefined) {
        return `${entry.updateId}:${entry.tweetId}`
    }

    if (entry.eventId) {
        return `${entry.eventId}:${entry.tweetId}`
    }

    return `${entry.tweetId}:${entry.rating}:${entry.timestamp}`
}

async function loadActiveFeedbackBatch(kvStore: any): Promise<ActiveFeedbackBatch | null> {
    return await loadFromKv<ActiveFeedbackBatch | null>(kvStore, ACTIVE_BATCH_KEY, null)
}

async function appendFeedbackEntries(kvStore: any, newEntries: FeedbackEntry[]): Promise<number> {
    if (!newEntries.length) return 0

    const existingFeedback = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
    const safeExisting = Array.isArray(existingFeedback) ? existingFeedback : []
    const existingKeys = new Set(safeExisting.map(getFeedbackDedupKey))

    const dedupedNewEntries = newEntries.filter((entry) => {
        const key = getFeedbackDedupKey(entry)
        if (existingKeys.has(key)) return false
        existingKeys.add(key)
        return true
    })

    await saveJsonToKv(kvStore, FEEDBACK_KEY, [...safeExisting, ...dedupedNewEntries])
    return dedupedNewEntries.length
}

export function isNoneReply(text = ""): boolean {
    const normalized = text.trim().toLowerCase()
    return normalized === "none" || normalized === "no" || normalized === "skip"
}

export function parseNumberList(text = "", maxIndex: number): number[] {
    if (!text || maxIndex <= 0) return []

    const matches = text.match(/\d+/g) || []
    const seen = new Set<number>()
    const numbers: number[] = []

    for (const match of matches) {
        const value = Number.parseInt(match, 10)
        if (!Number.isFinite(value) || value < 1 || value > maxIndex || seen.has(value)) {
            continue
        }

        seen.add(value)
        numbers.push(value)
    }

    return numbers
}

export function resolvePromptKind(replyToMessageId: number, activeBatch: ActiveFeedbackBatch | null): PromptKind | null {
    if (!activeBatch) return null
    if (replyToMessageId === activeBatch.likePromptMessageId) return "like"
    if (replyToMessageId === activeBatch.dislikePromptMessageId) return "dislike"
    return null
}

export function finalizeBatchReplies(activeBatch: ActiveFeedbackBatch | null): FeedbackEntry[] {
    if (!activeBatch) return []

    const tweetByIndex = new Map(activeBatch.tweets.map((tweet) => [tweet.index, tweet]))
    const resolved = new Map<number, { rating: FeedbackRating; reply: PromptReplyState }>()

    const applyReply = (reply: PromptReplyState | undefined, rating: FeedbackRating) => {
        if (!reply || isNoneReply(reply.text)) return

        for (const index of parseNumberList(reply.text, activeBatch.tweets.length)) {
            const existing = resolved.get(index)
            if (!existing || reply.updateId > existing.reply.updateId) {
                resolved.set(index, { rating, reply })
            }
        }
    }

    applyReply(activeBatch.likeReply, "good")
    applyReply(activeBatch.dislikeReply, "bad")

    return [...resolved.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([index, details]) => {
            const tweet = tweetByIndex.get(index)
            if (!tweet) return []

            return [{
                eventId: String(details.reply.messageId),
                updateId: details.reply.updateId,
                tweetId: tweet.tweetId,
                rating: details.rating,
                tweetSnippet: tweet.tweetSnippet,
                timestamp: details.reply.timestamp,
            }]
        })
}

export function createActiveFeedbackBatch(
    chatId: string,
    tweets: TweetRecord[],
    sentBatch: SentFeedbackBatch
): ActiveFeedbackBatch {
    const sentAt = sentBatch.sentAt

    return {
        batchId: `${sentAt}:${sentBatch.aggregateMessageId}`,
        chatId: String(chatId),
        sentAt,
        aggregateMessageId: sentBatch.aggregateMessageId,
        likePromptMessageId: sentBatch.likePromptMessageId,
        dislikePromptMessageId: sentBatch.dislikePromptMessageId,
        tweets: tweets.map((tweet, index) => ({
            index: index + 1,
            tweetId: getTweetId(tweet, `tweet_${index + 1}`),
            tweetSnippet: normalizeSnippet(getTweetText(tweet)),
        })),
    }
}

export async function saveActiveFeedbackBatch(kvStore: any, batch: ActiveFeedbackBatch | null): Promise<void> {
    await saveJsonToKv(kvStore, ACTIVE_BATCH_KEY, batch)
}

export async function collectFeedback(
    kvStore: any,
    telegramClient: TelegramClientForFeedback,
    chatId: string
): Promise<number> {
    console.log("Collecting feedback from Telegram update queue...")

    let activeBatch = await loadActiveFeedbackBatch(kvStore)
    const state = await loadFromKv<TelegramOffsetState>(kvStore, TELEGRAM_OFFSET_KEY, { offset: 0 })
    let offset = state.offset || 0
    let hasMore = true
    let batchCount = 0
    const MAX_BATCHES = 10

    while (hasMore && batchCount < MAX_BATCHES) {
        batchCount++

        try {
            const updates = await telegramClient.getUpdates(offset, 100, ["message"])

            if (updates.length === 0) {
                hasMore = false
                break
            }

            console.log(`Processing batch ${batchCount} of ${updates.length} updates (offset: ${offset})...`)
            let nextOffset = offset

            for (const update of updates) {
                nextOffset = update.update_id + 1

                if (!update.message) {
                    continue
                }

                const message = update.message
                const messageText = (message.text || "").trim()
                const replyToMessageId = message.reply_to_message?.message_id
                const messageChatId = String(message.chat?.id || "")

                if (messageChatId !== String(chatId)) {
                    continue
                }

                if (!replyToMessageId) {
                    continue
                }

                const promptKind = resolvePromptKind(replyToMessageId, activeBatch)
                if (!promptKind) {
                    continue
                }

                if (!activeBatch) {
                    continue
                }

                if (!messageText) {
                    console.warn(`Ignoring empty ${promptKind} reply in message ${message.message_id}.`)
                    continue
                }

                const parsedNumbers = parseNumberList(messageText, activeBatch.tweets.length)
                if (!isNoneReply(messageText) && parsedNumbers.length === 0) {
                    console.warn(`Ignoring malformed ${promptKind} reply "${messageText}" in message ${message.message_id}.`)
                    continue
                }

                const promptReply = buildPromptReplyState(update)
                if (!promptReply) continue

                if (promptKind === "like") {
                    activeBatch = { ...activeBatch, likeReply: promptReply }
                } else {
                    activeBatch = { ...activeBatch, dislikeReply: promptReply }
                }
            }

            await saveActiveFeedbackBatch(kvStore, activeBatch)
            await saveJsonToKv(kvStore, TELEGRAM_OFFSET_KEY, { offset: nextOffset })
            offset = nextOffset

            if (updates.length < 100) {
                hasMore = false
            }
        } catch (error: any) {
            console.error("Error fetching Telegram updates batch:", error?.response?.data || error?.message || error)
            hasMore = false
        }
    }

    if (batchCount >= MAX_BATCHES) {
        console.warn(`Reached MAX_BATCHES (${MAX_BATCHES}). Some updates might still be in the queue and will be processed next run.`)
    }

    const finalizedEntries = finalizeBatchReplies(activeBatch)
    const appendedCount = await appendFeedbackEntries(kvStore, finalizedEntries)

    if (activeBatch) {
        await saveActiveFeedbackBatch(kvStore, null)

        if (appendedCount > 0) {
            const latestFeedback = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
            const totalHistory = Array.isArray(latestFeedback) ? latestFeedback.length : 0
            console.log(`Finalized batch ${activeBatch.batchId}. Saved ${appendedCount} feedback entries. Total history: ${totalHistory}`)
        } else {
            console.log(`Finalized batch ${activeBatch.batchId} with no new feedback.`)
        }
    } else {
        console.log("No active feedback batch to finalize.")
    }

    const currentFeedback = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
    return Array.isArray(currentFeedback) ? currentFeedback.length : 0
}
