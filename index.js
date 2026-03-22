require('dotenv').config();
const { ApifyClient } = require('apify-client');
const axios = require('axios');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ACTOR_ID = process.env.APIFY_ACTOR_ID;

const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}

async function main() {
    console.log('Starting scraper job...');
    if (!APIFY_TOKEN || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Missing required environment variables.");
        process.exit(1);
    }

    try {
        // Define the search input for the Actor.
        // You can tweak these searchTerms to your exact niche (e.g., 'SaaS', 'AI Agents').
        const runInput = {
            searchTerms: [
                "tech",
                "webdev",
                "SaaS startup"
            ],
            searchMode: "live", // "live" searches for latest tweets
            maxItems: 10 // Strictly limits the output to save credits
        };

        console.log(`Calling Apify Actor ${ACTOR_ID}...`);
        // Start the Apify Actor execution and wait for completion
        const run = await apifyClient.actor(ACTOR_ID).call(runInput);
        console.log(`Actor finished properly. Run ID: ${run.id}`);

        // Fetch dataset items resulting from the run
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        console.log(`Fetched ${items.length} tweets.`);

        if (items.length === 0) {
            console.log('No tweets found. Exiting.');
            return;
        }

        await sendTelegramMessage(`🚀 <b>New batch of tech tweets!</b>\n<i>Found ${items.length} top tweets for you to reply to:</i>`);

        // Send a message for each tweet found
        for (const tweet of items) {
            // Note: Data models differ slightly between Actors. 
            // We handle the most common property structures.
            const author = tweet.author?.userName || tweet.user?.screen_name || 'Unknown User';
            const text = tweet.text || tweet.full_text || 'No text content';
            const url = tweet.url || `https://x.com/${author}/status/${tweet.id}`;
            
            const message = `👤 <b>@${author}</b>\n\n💬 <i>${text.substring(0, 180)}${text.length > 180 ? '...' : ''}</i>\n\n🔗 <a href="${url}">Open in X and Reply</a>`;
            
            await sendTelegramMessage(message);
            
            // Telegram rate limit is usually 30 messages/second, but 
            // inserting a small delay is best practice to avoid HTTP 429
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        console.log('All tweets forwarded to Telegram successfully.');
    } catch (error) {
        console.error('Fatal Error executing bot:', error);
        process.exit(1);
    }
}

main();
