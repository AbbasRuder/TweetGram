import { ApifyClient } from "apify-client/browser"
import OpenAI from "openai"

import { RULES_KEY } from "../src/config/constants"
import { assertBotEnv, getEnv } from "../src/config/env"
import { getOrCreateKvStore, loadFromKv, saveTextToKv } from "../src/lib/kvStore"
import { createTelegramClient } from "../src/lib/telegram"

// Simple type definitions for the serverless function
export default async function handler(req: any, res: any) {
    // Only allow POST from Telegram
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const update = req.body
    const message = update?.message
    const chatId = message?.chat?.id ? String(message.chat.id) : null

    try {
        const env = getEnv()
        assertBotEnv(env)

        if (!message || !message.text) {
            return res.status(200).json({ status: 'ignored', reason: 'No text message' })
        }

        if (chatId !== String(env.telegramChatId)) {
            console.warn(`Unauthorized message from chatId: ${chatId}`)
            return res.status(200).json({ status: 'ignored', reason: 'Unauthorized chat ID' })
        }

        const telegramClient = createTelegramClient({
            botToken: env.telegramBotToken!,
            chatId: env.telegramChatId!,
        })

        const text = message.text.trim()
        console.log(`[Webhook] User instruction: "${text}"`)

        const apifyClient = new ApifyClient({ token: env.apifyToken })
        const openai = new OpenAI({ 
            apiKey: env.nvidiaApiKey, 
            baseURL: 'https://integrate.api.nvidia.com/v1',
            timeout: 30000 // 30 second timeout for AI calls
        })
        
        console.log(`[Webhook] Connecting to Apify KV Store...`)
        const kvStore = await getOrCreateKvStore(apifyClient)

        console.log(`[Webhook] Loading current rules...`)
        const existingRules = await loadFromKv<string>(kvStore, RULES_KEY, "")

        const prompt = `You are the brain of a tweet-filtering bot. 
The user is sending you an instruction to update the filtering rules.

CURRENT RULES:
---
${existingRules || "No rules set yet."}
---

USER INSTRUCTION:
"${text}"

TASK:
1. Figure out if the user's instruction is asking to modify the filtering rules (e.g. "stop showing crypto", "add more AI", "I like this topic").
2. If it is a rule update, generate the ENTIRE updated RULES list as a clear, concise bulleted list. 
   - CRITICAL: You MUST merge the new request with the existing rules. Do NOT delete unrelated existing rules.
   - Output ONLY the new ruleset. No conversational text.
3. If the user's instruction is NOT a rule update (e.g. "hi", "what are you doing", "help"), simply output the exact string: "[NOT A RULE UPDATE]". Do not output anything else.
`

        console.log(`[Webhook] Requesting rule update from NVIDIA (deepseek-ai/deepseek-v3.2)...`)
        const completion = await openai.chat.completions.create({
            model: "deepseek-ai/deepseek-v3.2",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 1024,
        })
        
        const responseText = (completion.choices[0]?.message?.content || "").trim()
        console.log(`[Webhook] AI update generated (${responseText.length} chars).`)

        if (responseText === "[NOT A RULE UPDATE]") {
            console.log(`[Webhook] Not a rule update. Sending help message.`)
            try {
                await telegramClient.sendMessage(chatId!, "I am your tweet filter bot. Send me instructions to update your preferences, e.g., 'Stop showing me crypto tweets'.")
            } catch (te) {
                console.error("[Webhook] Failed to send help message to Telegram")
            }
            return res.status(200).json({ status: 'success', message: 'Not a rule update' })
        }

        // Backup existing rules just in case
        if (existingRules) {
            const backupKey = `rules-backup-${new Date().toISOString().split("T")[0]}`
            console.log(`[Webhook] Creating backup at: ${backupKey}`)
            try {
                await saveTextToKv(kvStore, backupKey, existingRules)
            } catch (be) {
                console.warn("[Webhook] Backup failed, continuing with rule update...")
            }
        }

        // Save new rules
        console.log(`[Webhook] Saving new ruleset...`)
        await saveTextToKv(kvStore, RULES_KEY, responseText)

        // Confirm to user
        console.log(`[Webhook] Update complete. Notifying user via Telegram.`)
        try {
            await telegramClient.sendMessage(chatId!, "<b>Rules updated successfully!</b>\n\nI'll use these new preferences for the next batch of tweets.")
        } catch (te) {
            console.error("[Webhook] Failed to send confirmation to Telegram")
        }
        
        return res.status(200).json({ status: 'success', message: 'Rules updated' })
        
        // Final success response to Telegram
        return res.status(200).json({ status: 'success', message: 'Rules updated' })

    } catch (error: any) {
        console.error("Webhook Error:", error)
        
        // Attempt to notify user of the error if we have a chatId
        if (chatId) {
            try {
                const env = getEnv()
                if (env.telegramBotToken) {
                    const telegramClient = createTelegramClient({
                        botToken: env.telegramBotToken,
                        chatId: chatId,
                    })
                    await telegramClient.sendMessage(chatId, `⚠️ <b>Error processing rule update</b>\n\nDetails: <i>${error.message || "Unknown error"}</i>\n\nPlease check the Vercel logs for more info.`)
                }
            } catch (notifyError) {
                console.error("Failed to notify user of error:", notifyError)
            }
        }

        // CRITICAL: Always return 200 OK to Telegram to prevent infinite retry loops
        return res.status(200).json({ status: 'error', error: error.message || 'Internal Server Error' })
    }
}
