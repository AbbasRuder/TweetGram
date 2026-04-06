import 'dotenv/config';
import handler from '../../api/webhook';
import { getEnv } from '../config/env';

/**
 * Mock Request and Response for local testing of the Vercel handler
 */
async function testWebhook() {
    const env = getEnv();
    const testMessage = process.argv[2] || "Update rules: I want to see more about AI agents and deep learning.";

    console.log("===========================================");
    console.log("  Webhook Local Test Runner");
    console.log("===========================================");
    console.log(`Simulating message: "${testMessage}"`);
    console.log(`Sending to Chat ID: ${env.telegramChatId}`);
    console.log("-------------------------------------------");

    const req = {
        method: 'POST',
        body: {
            update_id: Math.floor(Math.random() * 100000),
            message: {
                message_id: Math.floor(Math.random() * 10000),
                text: testMessage,
                chat: { id: env.telegramChatId },
                date: Math.floor(Date.now() / 1000)
            }
        }
    };

    const res = {
        status: (code: number) => {
            console.log(`HTTP Status: ${code}`);
            return res;
        },
        json: (data: any) => {
            console.log("Response Data:", JSON.stringify(data, null, 2));
            return res;
        }
    };

    try {
        await handler(req, res);
        console.log("-------------------------------------------");
        console.log("Test execution finished.");
    } catch (err) {
        console.error("Test execution failed:", err);
    }
}

testWebhook();
