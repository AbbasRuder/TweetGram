import axios from 'axios';

import type { SentFeedbackBatch, TweetRecord } from '../types/domain';
import { escapeHtml, getTweetAuthor, getTweetText, getTweetUrl } from './tweet';

interface TelegramClientConfig {
    botToken: string;
    chatId: string;
}

export interface TelegramMessage {
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

export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
}

export function createTelegramClient(config: TelegramClientConfig) {
    const callApi = async <T>(method: string, data: Record<string, unknown>): Promise<T> => {
        try {
            const response = await axios.post(`https://api.telegram.org/bot${config.botToken}/${method}`, data, {
                timeout: 10000 // 10 second timeout to prevent hangs
            });
            return response.data?.result as T;
        } catch (error: any) {
            const status = error.response?.status;
            const message = error.response?.data?.description || error.message;
            console.error(`[Telegram API Error] ${method} failed (${status || 'No Status'}): ${message}`);
            throw error;
        }
    };

    async function sendMessage(chatId: string | number, text: string, options: Record<string, unknown> = {}): Promise<TelegramMessage> {
        return await callApi<TelegramMessage>('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            ...options
        });
    }

    async function sendFeedbackBatch(tweets: TweetRecord[]): Promise<SentFeedbackBatch> {
        if (!tweets.length) {
            throw new Error('sendFeedbackBatch requires at least one tweet.');
        }

        const formattedLines = tweets.map((tweet, index) => {
            const author = getTweetAuthor(tweet);
            const text = getTweetText(tweet).replace(/\n/g, ' ');
            const url = getTweetUrl(tweet, index);
            const shortText = escapeHtml(text.substring(0, 280) + (text.length > 280 ? '...' : ''));
            const safeAuthor = escapeHtml(author);
            return `${index + 1}. <b>@${safeAuthor}</b> - <i>${shortText}</i>\n<a href="${url}">Open in X</a>`;
        });

        const CHUNK_SIZE = 8;
        const sentAt = new Date().toISOString();
        let firstMessageId: number | undefined;

        for (let i = 0; i < formattedLines.length; i += CHUNK_SIZE) {
            const chunk = formattedLines.slice(i, i + CHUNK_SIZE);
            const isFirst = i === 0;
            const header = isFirst 
                ? `<b>New batch of tweets</b>\n<i>${tweets.length} high-quality tweets found:</i>`
                : `<b>Batch continued...</b>`;
            
            const message = [header, ...chunk].join('\n\n');

            const sent = await callApi<TelegramMessage>('sendMessage', {
                chat_id: config.chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { remove_keyboard: true }
            });

            if (isFirst) firstMessageId = sent.message_id;
        }

        return {
            sentAt,
            aggregateMessageId: firstMessageId || 0,
        };
    }

    async function getUpdates(offset: number, limit = 100, allowed_updates: string[] = ['message']): Promise<TelegramUpdate[]> {
        return await callApi<TelegramUpdate[]>('getUpdates', { offset, timeout: 0, limit, allowed_updates });
    }

    return {
        sendFeedbackBatch,
        getUpdates,
        sendMessage
    };
}
