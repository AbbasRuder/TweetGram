export interface TweetAuthor {
    userName?: string;
}

export interface TweetUser {
    screen_name?: string;
}

export interface TweetRecord {
    id?: string | number;
    tweetId?: string | number;
    tweet_id?: string | number;
    text?: string;
    full_text?: string;
    url?: string;

    author?: TweetAuthor;
    user?: TweetUser;

    isRetweet?: boolean;
    is_retweet?: boolean;
    retweeted?: boolean;
    retweeted_status?: unknown;
    retweetedStatus?: unknown;

    isReply?: boolean;
    is_reply?: boolean;
    inReplyToStatusId?: string | number;
    inReplyToTweetId?: string | number;
    in_reply_to_status_id?: string | number;
    in_reply_to_status_id_str?: string;
    in_reply_to_tweet_id?: string | number;
    inReplyToUserId?: string | number;
    in_reply_to_user_id?: string | number;

    conversationId?: string | number;
    conversation_id?: string | number;
    conversationIdStr?: string;
}

export type FeedbackRating = 'good' | 'bad';

export interface FeedbackEntry {
    eventId?: string;
    updateId?: number;
    tweetId: string;
    rating: FeedbackRating;
    tweetSnippet: string;
    timestamp: string;
}

export interface TelegramOffsetState {
    offset: number;
}
