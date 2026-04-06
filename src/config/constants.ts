export const MAX_TWEETS_PER_FETCH = 30;
export const MAX_TWEETS_FOR_TELEGRAM = 15;

export const KV_STORE_NAME = 'twitter-bot-brain-v2-final-debug';
export const RULES_KEY = 'master-rules';

export const TOPIC_QUERIES = [
    '(#buildinpublic OR "micro saas" OR "microsaas" OR #indiehackers OR "just launched" OR "MRR") min_faves:10 -filter:replies lang:en -crypto -nft -web3 -btc',
    '("software engineering" OR "system design" OR "Next.js" OR "React" OR "Node.js" OR "TypeScript") min_faves:10 -filter:replies lang:en -crypto -nft',
    '("AI agents" OR "agentic" OR "LLMs" OR "OpenAI" OR "Anthropic" OR "Cursor" OR "RAG" OR "LangChain" OR "CrewAI") min_faves:10 -filter:replies lang:en -crypto -nft',
    '("b2b saas" OR "saas growth" OR "indie maker" OR "founder lessons" OR "solopreneur" OR "bootstrapped") min_faves:10 -filter:replies lang:en -crypto'
] as const;

export const SPAM_KEYWORDS = [
    'crypto', 'btc', 'eth', 'nft', 'web3', 'airdrop', 'giveaway',
    'pump', 'token', 'presale', 'memecoin', 'solana', 'binance',
    'retweet to win', 'rt to', '100x', 'join our telegram'
] as const;
