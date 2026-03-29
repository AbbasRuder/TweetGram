import axios from 'axios';

import type { SentFeedbackBatch, TweetRecord } from '../types/domain';
import { escapeHtml, getTweetAuthor, getTweetText, getTweetUrl } from './tweet';

interface TelegramClientConfig {
    botToken: string;
    chatId: string;
}

interface TelegramMessage {
    message_id: number;
    text?: string;
    date?: number;
    chat?: {
        id: number | string;
    };
    from?: {
        id: number | string;
    };
    reply_to_message?: {
        message_id: number;
    };
}

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
}

export function createTelegramClient(config: TelegramClientConfig) {
    const callApi = async <T>(method: string, data: Record<string, unknown>): Promise<T> => {
        const response = await axios.post(`https://api.telegram.org/bot${config.botToken}/${method}`, data);
        return response.data?.result as T;
    };

    async function sendFeedbackBatch(tweets: TweetRecord[]): Promise<SentFeedbackBatch> {
        if (!tweets.length) {
            throw new Error('sendFeedbackBatch requires at least one tweet.');
        }

        const lines = tweets.map((tweet, index) => {
            const author = getTweetAuthor(tweet);
            const text = getTweetText(tweet).replace(/\n/g, ' ');
            const url = getTweetUrl(tweet, index);
            const shortText = escapeHtml(text.substring(0, 150) + (text.length > 150 ? '...' : ''));
            const safeAuthor = escapeHtml(author);
            return `${index + 1}. <b>@${safeAuthor}</b> - <i>${shortText}</i>\n<a href="${url}">Open in X</a>`;
        });

        const header = `<b>New batch of tweets</b>\n<i>${tweets.length} tweets ready for feedback:</i>`;
        const message = [header, ...lines].join('\n\n');
        const sentAt = new Date().toISOString();

        const aggregateMessage = await callApi<TelegramMessage>('sendMessage', {
            chat_id: config.chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });

        const likePrompt = await callApi<TelegramMessage>('sendMessage', {
            chat_id: config.chatId,
            text: "Reply to this message with the tweet numbers you liked.\nExample: 1 4 7\nSend 'none' if none.",
            reply_to_message_id: aggregateMessage.message_id,
            reply_markup: {
                force_reply: true,
                input_field_placeholder: 'e.g. 1 4 7 or none',
                selective: true
            }
        });

        const dislikePrompt = await callApi<TelegramMessage>('sendMessage', {
            chat_id: config.chatId,
            text: "Reply to this message with the tweet numbers you disliked.\nExample: 2 5 9\nSend 'none' if none.",
            reply_to_message_id: aggregateMessage.message_id,
            reply_markup: {
                force_reply: true,
                input_field_placeholder: 'e.g. 2 5 9 or none',
                selective: true
            }
        });

        return {
            sentAt,
            aggregateMessageId: aggregateMessage.message_id,
            likePromptMessageId: likePrompt.message_id,
            dislikePromptMessageId: dislikePrompt.message_id
        };
    }

    async function getUpdates(offset: number, limit = 100, allowed_updates: string[] = ['message']): Promise<TelegramUpdate[]> {
        return await callApi<TelegramUpdate[]>('getUpdates', { offset, timeout: 0, limit, allowed_updates });
    }

    return {
        sendFeedbackBatch,
        getUpdates
    };
}
