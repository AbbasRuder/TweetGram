import { ApifyClient } from "apify-client"
import { GoogleGenerativeAI } from "@google/generative-ai"

import { FEEDBACK_KEY, MIN_FEEDBACK_THRESHOLD, RULES_KEY } from "./config/constants"
import { assertTrainingEnv, getEnv } from "./config/env"
import { getOrCreateKvStore, loadFromKv, saveTextToKv } from "./lib/kvStore"
import { synthesizeMasterRules } from "./train/synthesizer"
import type { FeedbackEntry } from "./types/domain"

async function runTraining(): Promise<void> {
    console.log("===========================================")
    console.log("  Brain Trainer - Daily Rule Synthesis")
    console.log("===========================================")

    const env = getEnv()
    assertTrainingEnv(env)

    const apifyClient = new ApifyClient({ token: env.apifyToken })
    const genAI = new GoogleGenerativeAI(env.geminiApiKey)
    const kvStore = await getOrCreateKvStore(apifyClient)

    const feedbackLog = await loadFromKv<FeedbackEntry[]>(kvStore, FEEDBACK_KEY, [])
    console.log(`Total feedback entries in history: ${feedbackLog.length}`)

    if (feedbackLog.length < MIN_FEEDBACK_THRESHOLD) {
        console.log(`Not enough feedback yet (${feedbackLog.length}/${MIN_FEEDBACK_THRESHOLD}). Skipping training.`)
        console.log("The brain will train once more feedback is collected. Exiting.")
        return
    }

    const existingRules = await loadFromKv<string>(kvStore, RULES_KEY, "")

    try {
        console.log("Sending feedback history to LLM for analysis...")
        const newRules = await synthesizeMasterRules(genAI, feedbackLog, existingRules)

        console.log("\nNew master rules:")
        console.log(newRules)
        console.log("")

        await saveTextToKv(kvStore, RULES_KEY, newRules)
        console.log("Master rules updated and saved to Apify KV Store.")

        const backupKey = `rules-backup-${new Date().toISOString().split("T")[0]}`
        await saveTextToKv(kvStore, backupKey, newRules)
        console.log(`Backup saved as "${backupKey}"`)
    } catch (error: any) {
        console.error("LLM training failed:", error?.message || error)
        process.exit(1)
    }
}

runTraining().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
})
