export { MongoStorageAdapter } from "./MongoStorageAdapter.js";
export { connectDB } from "./config/db.js";

// ─── Model exports (for advanced usage) ──────────────────────────────────────
export { VaultEntry } from "./models/VaultEntry.js";
export type { IVaultEntryDoc } from "./models/VaultEntry.js";
export { Synapse } from "./models/Synapse.js";
export type { ISynapseDoc } from "./models/Synapse.js";
export { Action } from "./models/Action.js";
export type { IActionDoc } from "./models/Action.js";
export { ChatHistory } from "./models/ChatHistory.js";
export type { IChatHistoryDoc, IChatMessageDoc } from "./models/ChatHistory.js";
