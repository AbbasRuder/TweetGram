export const MAX_TWEETS_PER_FETCH = 30;
export const MAX_TWEETS_FOR_TELEGRAM = 15;

export const KV_STORE_NAME = 'twitter-bot-brain-v2-final-debug';
export const FEEDBACK_KEY = 'feedback';
export const RULES_KEY = 'master-rules';
export const TELEGRAM_OFFSET_KEY = 'telegram-offset';
export const ACTIVE_BATCH_KEY = 'active-feedback-batch';

export const MIN_FEEDBACK_THRESHOLD = 15;

export const TOPIC_QUERIES = [
    '(#buildinpublic OR "micro saas" OR "microsaas" OR #indiehackers) min_faves:4 lang:en -crypto -nft -web3 -btc',
    '("software engineering" OR "web development" OR #100DaysOfCode OR "reactjs" OR "nextjs") min_faves:5 lang:en -crypto -nft',
    '("AI agents" OR "LLMs" OR OpenAI OR Anthropic OR Cursor OR "generative ai" OR Gemini) min_faves:10 lang:en -crypto -nft',
    '("saas marketing" OR "b2b saas" OR "indie maker" OR "founder") min_faves:3 lang:en -crypto'
] as const;

export const SPAM_KEYWORDS = [
    'crypto', 'btc', 'eth', 'nft', 'web3', 'airdrop', 'giveaway',
    'pump', 'token', 'presale', 'memecoin', 'solana', 'binance',
    'retweet to win', 'rt to', '100x', 'join our telegram'
] as const;
