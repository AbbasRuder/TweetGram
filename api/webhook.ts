import { ApifyClient } from "apify-client"
import { GoogleGenerativeAI } from "@google/generative-ai"

import { RULES_KEY } from "../src/config/constants"
import { assertBotEnv, getEnv } from "../src/config/env"
import { getOrCreateKvStore, loadFromKv, saveTextToKv } from "../src/lib/kvStore"
import { createTelegramClient } from "../src/lib/telegram"

// Simple type definitions for the serverless function
export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    try {
        const env = getEnv()
        assertBotEnv(env)

        const update = req.body
        const message = update?.message

        if (!message || !message.text) {
            return res.status(200).json({ status: 'ignored', reason: 'No text message' })
        }

        const chatId = String(message.chat.id)
        if (chatId !== String(env.telegramChatId)) {
            return res.status(200).json({ status: 'ignored', reason: 'Unauthorized chat ID' })
        }

        const telegramClient = createTelegramClient({
            botToken: env.telegramBotToken!,
            chatId: env.telegramChatId!,
        })

        const text = message.text.trim()

        // Inform user we are processing
        await telegramClient.sendMessage(chatId, "<i>Processing your instruction...</i>")

        const apifyClient = new ApifyClient({ token: env.apifyToken })
        const genAI = new GoogleGenerativeAI(env.geminiApiKey)
        const kvStore = await getOrCreateKvStore(apifyClient)

        const existingRules = await loadFromKv<string>(kvStore, RULES_KEY, "")

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

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

        const result = await model.generateContent(prompt)
        const responseText = result.response.text().trim()

        if (responseText === "[NOT A RULE UPDATE]") {
            await telegramClient.sendMessage(chatId, "I am your tweet filter bot. Send me instructions to update your preferences, e.g., 'Stop showing me crypto tweets'.")
            return res.status(200).json({ status: 'success', message: 'Not a rule update' })
        }

        // Backup existing rules just in case
        if (existingRules) {
            const backupKey = `rules-backup-${new Date().toISOString().split("T")[0]}`
            await saveTextToKv(kvStore, backupKey, existingRules)
        }

        // Save new rules
        await saveTextToKv(kvStore, RULES_KEY, responseText)

        // Confirm to user
        await telegramClient.sendMessage(chatId, "<b>Rules updated successfully!</b>\n\nI'll use these new preferences for the next batch of tweets.")
        
        return res.status(200).json({ status: 'success', message: 'Rules updated' })

    } catch (error: any) {
        console.error("Webhook Error:", error)
        return res.status(500).json({ error: 'Internal Server Error' })
    }
}
