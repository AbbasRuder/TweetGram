import 'dotenv/config';

export interface AppEnv {
    apifyToken: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    nvidiaApiKey: string;
    actorId: string;
}

const DEFAULT_ACTOR_ID = 'xquik/twitter-scraper';

export function getEnv(): AppEnv {
    return {
        apifyToken: process.env.APIFY_TOKEN || '',
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
        telegramChatId: process.env.TELEGRAM_CHAT_ID,
        nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
        actorId: process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR_ID
    };
}

export function assertBotEnv(env: AppEnv): void {
    if (!env.apifyToken || !env.telegramBotToken || !env.telegramChatId || !env.nvidiaApiKey) {
        throw new Error('Missing required environment variables. Need: APIFY_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NVIDIA_API_KEY');
    }
}
