import { SPAM_KEYWORDS } from '../config/constants';
import type { TweetRecord } from '../types/domain';

export function escapeHtml(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function normalizeId(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

export function getTweetAuthor(tweet: TweetRecord): string {
    return tweet.author?.userName || tweet.user?.screen_name || 'unknown';
}

export function getTweetText(tweet: TweetRecord): string {
    return tweet.text || tweet.full_text || '';
}

export function getTweetId(tweet: TweetRecord, fallback = ''): string {
    return normalizeId(tweet.id || tweet.tweetId || tweet.tweet_id || fallback);
}

export function getTweetUrl(tweet: TweetRecord, fallbackIndex = 0): string {
    const author = getTweetAuthor(tweet);
    const tweetId = getTweetId(tweet, `${author}_${fallbackIndex}`);
    return tweet.url || `https://x.com/${author}/status/${tweetId}`;
}

export function getRelativeTime(createdAt?: string): string {
    if (!createdAt) return "";
    const now = Date.now();
    const created = new Date(createdAt).getTime();
    if (isNaN(created)) return "";
    
    const diffMs = Math.max(0, now - created);
    const mins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(mins / 60);

    if (hours > 0) {
        const remainingMins = mins % 60;
        return `${hours}h ${remainingMins}m ago`;
    }
    return `${mins}m ago`;
}

export function isSpam(text: string): boolean {
    if (!text) return true;
    const lower = text.toLowerCase();
    return SPAM_KEYWORDS.some(keyword => lower.includes(keyword));
}

export function isRetweet(tweet: TweetRecord): boolean {
    return Boolean(
        tweet.isRetweet ||
        tweet.is_retweet ||
        tweet.retweeted ||
        tweet.retweeted_status ||
        tweet.retweetedStatus
    );
}

export function isReply(tweet: TweetRecord): boolean {
    return Boolean(
        tweet.isReply ||
        tweet.is_reply ||
        tweet.inReplyToStatusId ||
        tweet.inReplyToTweetId ||
        tweet.in_reply_to_status_id ||
        tweet.in_reply_to_status_id_str ||
        tweet.in_reply_to_tweet_id ||
        tweet.inReplyToUserId ||
        tweet.in_reply_to_user_id
    );
}

export function isThreadChild(tweet: TweetRecord): boolean {
    const tweetId = getTweetId(tweet);
    const conversationId = normalizeId(
        tweet.conversationId || tweet.conversation_id || tweet.conversationIdStr
    );

    if (!tweetId || !conversationId) return false;
    return tweetId !== conversationId;
}

export function isMainOrParentTweet(tweet: TweetRecord): boolean {
    return !isRetweet(tweet) && !isReply(tweet) && !isThreadChild(tweet);
}
