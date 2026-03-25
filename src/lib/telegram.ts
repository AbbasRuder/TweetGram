import axios from 'axios';
import type { FeedbackRating, TweetRecord } from '../types/domain';
import { escapeHtml, getTweetAuthor, getTweetId, getTweetText, getTweetUrl } from './tweet';

interface TelegramClientConfig {
    botToken: string;
    chatId: string;
}

interface TelegramUpdate {
    update_id: number;
    callback_query?: {
        id: string;
        data?: string;
        message?: {
            text?: string;
        };
    };
}

export function createTelegramClient(config: TelegramClientConfig) {
    const callApi = (method: string, data: Record<string, unknown>) =>
        axios.post(`https://api.telegram.org/bot${config.botToken}/${method}`, data);

    async function sendAggregatedTweets(tweets: TweetRecord[]): Promise<void> {
        if (!tweets.length) return;

        const lines = tweets.map((tweet, index) => {
            const author = getTweetAuthor(tweet);
            const text = getTweetText(tweet).replace(/\n/g, ' ');
            const url = getTweetUrl(tweet, index);
            const shortText = escapeHtml(text.substring(0, 150) + (text.length > 150 ? '...' : ''));
            const safeAuthor = escapeHtml(author);
            return `${index + 1}. <b>@${safeAuthor}</b> — <i>${shortText}</i>\n🔗 <a href="${url}">Open in X</a>`;
        });

        const header = `🚀 <b>New batch of tweets!</b>\n<i>${tweets.length} high-quality tweets ready to reply:</i>`;
        const message = [header, ...lines].join('\n\n');

        const inline_keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
        for (let i = 0; i < tweets.length; i += 2) {
            const row: Array<{ text: string; callback_data: string }> = [];
            const addButtons = (tweetIndex: number) => {
                const tweet = tweets[tweetIndex];
                const tweetId = getTweetId(tweet, `${getTweetAuthor(tweet)}_${tweetIndex}`).substring(0, 30);
                row.push({ text: `${tweetIndex + 1} 👍`, callback_data: `good|${tweetIndex + 1}|${tweetId}` });
                row.push({ text: `${tweetIndex + 1} 👎`, callback_data: `bad|${tweetIndex + 1}|${tweetId}` });
            };

            addButtons(i);
            if (i + 1 < tweets.length) addButtons(i + 1);
            inline_keyboard.push(row);
        }

        await callApi('sendMessage', {
            chat_id: config.chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard }
        });
    }

    async function getUpdates(offset: number): Promise<TelegramUpdate[]> {
        const response = await callApi('getUpdates', { offset, timeout: 0 });
        return (response.data?.result || []) as TelegramUpdate[];
    }

    async function answerCallbackQuery(callbackQueryId: string, rating: FeedbackRating): Promise<void> {
        await callApi('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: rating === 'good' ? '👍 Noted!' : '👎 Got it!'
        });
    }

    return {
        sendAggregatedTweets,
        getUpdates,
        answerCallbackQuery
    };
}
