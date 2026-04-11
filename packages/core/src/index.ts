// ─── Main class ───────────────────────────────────────────────────────────────
export { Brain } from "./Brain.js";
export type { ActionHandler, ProcessResult, BrainConfig, BrainPlugin } from "./Brain.js";

// ─── Built-in plugins ─────────────────────────────────────────────────────────
export { MemoryPlugin } from "./plugins/MemoryPlugin.js";
export { SavingPlugin } from "./plugins/SavingPlugin.js";

// ─── Adapter interfaces ───────────────────────────────────────────────────────
export type { ILLMAdapter, LLMRequest } from "./adapters/ILLMAdapter.js";
export type { IEmbeddingAdapter } from "./adapters/IEmbeddingAdapter.js";
export type {
  IStorageAdapter,
  ActionInfo,
  EntryAnalysisData,
} from "./adapters/IStorageAdapter.js";

// ─── Built-in LLM adapters ────────────────────────────────────────────────────
export { OpenAICompatibleAdapter } from "./adapters/llm/OpenAICompatibleAdapter.js";
export { OpenAICompatibleEmbeddingAdapter } from "./adapters/embedding/OpenAICompatibleEmbeddingAdapter.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  TopicAnalysis,
  LongTermMemoryData,
  IVaultEntry,
  ILongTermMemory,
} from "./types/brain.js";

// ─── Services (public API) ────────────────────────────────────────────────────
export { classifyIntent } from "./services/ai/intent.service.js";
export type { ChatMessage, ClassifyIntentParams } from "./services/ai/intent.service.js";
export type { IntentResult, IntentSource } from "./services/ai/intent.types.js";
export { getBrainContext } from "./services/ai/intent.context.service.js";
export { runSubconsciousRoutine } from "./services/brain/subconscious.routine.js";
export type { SubconsciousStats } from "./services/brain/subconscious.routine.js";
export { runConsciousProcessor } from "./services/brain/conscious.processor.js";
export type { ConsciousStats } from "./services/brain/conscious.processor.js";

// ─── Config ───────────────────────────────────────────────────────────────────
export { LLM, BRAIN, MEMORY, ROUTING, CHAT, MISC } from "./config/constants.js";

// ─── Utils ────────────────────────────────────────────────────────────────────
export { cleanAndParseJSON } from "./utils/json.js";
