import { createTelegramClient } from "../src/lib/telegram"
import { assertBotEnv, getEnv } from "../src/config/env"
import { TARGET_LIST_ID } from "../src/config/constants"

export default async function handler(req: any, res: any) {
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

        // Simple static response as requested
        await telegramClient.sendMessage(chatId!, `I am currently fetching the latest tweets from your static Twitter List (ID: <code>${TARGET_LIST_ID}</code>).\n\nList updates via Telegram are currently disabled.`)
        
        return res.status(200).json({ status: 'success' })

    } catch (error: any) {
        console.error("Webhook Error:", error)
        return res.status(200).json({ status: 'error' })
    }
}
