import { assertBotEnv, getEnv } from "./config/env"
import { runAccountBot } from "./bot/accountScraper"
// import { runLegacyBot } from "./bot/legacyScraper"

async function main(): Promise<void> {
    const env = getEnv()
    try {
        assertBotEnv(env)
    } catch (e: any) {
        console.error("[Config Error] Environment check failed:", e.message)
        process.exit(1)
    }

    // Switch to the new account-based scraper as per user request
    console.log("[Bot] Launching Account-Based Scraper...")
    await runAccountBot(env)

    // Legacy topic-based search is kept as a dormant module
    // To re-enable, uncomment the following line and comment out runAccountBot above.
    // await runLegacyBot(env)
}

main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
})
