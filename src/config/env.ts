import 'dotenv/config';

export interface AppEnv {
    apifyToken: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    geminiApiKey: string;
    actorId: string;
}

const DEFAULT_ACTOR_ID = 'kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest';

export function getEnv(): AppEnv {
    return {
        apifyToken: process.env.APIFY_TOKEN || '',
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
        telegramChatId: process.env.TELEGRAM_CHAT_ID,
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        actorId: process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR_ID
    };
}

export function assertBotEnv(env: AppEnv): void {
    if (!env.apifyToken || !env.telegramBotToken || !env.telegramChatId || !env.geminiApiKey) {
        throw new Error('Missing required environment variables. Need: APIFY_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY');
    }
}

export function assertTrainingEnv(env: AppEnv): void {
    if (!env.apifyToken || !env.geminiApiKey) {
        throw new Error('Missing required env vars: APIFY_TOKEN, GEMINI_API_KEY');
    }
}
