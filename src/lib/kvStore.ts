import { ApifyClient } from "apify-client"
import { KV_STORE_NAME } from "../config/constants"

export async function getOrCreateKvStore(apifyClient: ApifyClient) {
    const stores = await apifyClient.keyValueStores().list()
    let store = stores.items.find((item) => item.name === KV_STORE_NAME)

    if (!store) {
        store = await apifyClient.keyValueStores().getOrCreate(KV_STORE_NAME)
    }

    return apifyClient.keyValueStore(store.id)
}

export async function loadFromKv<T>(kvStore: ReturnType<ApifyClient["keyValueStore"]>, key: string, fallback: T): Promise<T> {
    try {
        const record = await kvStore.getRecord(key)
        return (record?.value as T) ?? fallback
    } catch {
        return fallback
    }
}

export async function saveJsonToKv(
    kvStore: ReturnType<ApifyClient["keyValueStore"]>,
    key: string,
    value: unknown
): Promise<void> {
    await kvStore.setRecord({ key, value: value as any, contentType: "application/json" })
}

export async function saveTextToKv(kvStore: ReturnType<ApifyClient["keyValueStore"]>, key: string, value: string): Promise<void> {
    await kvStore.setRecord({ key, value, contentType: "text/plain" })
}
