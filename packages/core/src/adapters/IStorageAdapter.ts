import { IVaultEntry, ILongTermMemory, ICategory, TopicAnalysis, LongTermMemoryData } from "../types/brain.js";

export interface ActionInfo {
  name: string;
  description: string;
}

export interface CategoryInfo {
  name: string;
  description: string;
  keywords: string[];
}

export interface EntryAnalysisData {
  summary: string;
  tags: string[];
  strength: number;
  category: string;
  isProcessed: boolean;
  isPermanent?: boolean;
}

export interface IStorageAdapter {
  // ─── Entry CRUD ───────────────────────────────────────────────────────────
  createEntry(userId: string, rawText: string, analysis: EntryAnalysisData): Promise<IVaultEntry>;
  getEntryById(entryId: string): Promise<IVaultEntry | null>;

  // ─── Vault ────────────────────────────────────────────────────────────────
  getVaultData(userId: string): Promise<{
    entries: IVaultEntry[];
    memories: ILongTermMemory[];
    categories: ICategory[];
  }>;
  deleteVaultEntry(entryId: string, userId: string): Promise<IVaultEntry | null>;

  // ─── Shared ───────────────────────────────────────────────────────────────
  getCategories(): Promise<CategoryInfo[]>;
  getUniqueUserIds(): Promise<string[]>;
  getActions(): Promise<ActionInfo[]>;
  upsertAction(name: string, description: string, isBuiltIn?: boolean): Promise<void>;
  removeAction(name: string): Promise<void>;

  // ─── Chat History ─────────────────────────────────────────────────────────
  getChatHistory(userId: string): Promise<{ role: "user" | "assistant"; content: string }[]>;
  appendChatMessage(userId: string, role: "user" | "assistant", content: string, maxMessages: number): Promise<void>;

  // ─── User Profile ─────────────────────────────────────────────────────────
  getUserProfile(userId: string): Promise<string | null>;
  upsertUserProfile(userId: string, profile: string): Promise<void>;

  // ─── Intent Context ───────────────────────────────────────────────────────
  findRelevantEntries(userId: string, keywords: string[]): Promise<IVaultEntry[]>;
  findSimilarEntries(userId: string, embedding: number[], topK?: number): Promise<IVaultEntry[]>;
  updateEntryEmbedding(entryId: string, embedding: number[]): Promise<void>;

  // ─── Conscious Processor ──────────────────────────────────────────────────
  findDeltaEntries(userId: string, since: Date): Promise<IVaultEntry[]>;
  findContextEntries(userId: string, excludeIds: string[]): Promise<IVaultEntry[]>;
  applyTopicAnalysis(topic: TopicAnalysis): Promise<number>;
  findStrongEntries(userId: string): Promise<IVaultEntry[]>;
  upsertLTM(
    userId: string,
    topic: string,
    category: string,
    memoryData: LongTermMemoryData,
    entries: IVaultEntry[]
  ): Promise<void>;
  markConsolidated(entries: IVaultEntry[]): Promise<void>;

  // ─── Synapse Queries & Management ────────────────────────────────────────
  getSynapsesBySource(entryId: string, limit: number): Promise<{
    targetId: string;
    weight: number;
    reason: string;
    targetSummary?: string;
    targetRawText?: string;
  }[]>;
  processSynapseLinks(synapses: {
    sourceId: string;
    targetId: string;
    reason: string;
    strength: number;
  }[], deltaEntryIds: Set<string>): Promise<number>;

  // ─── Subconscious Routine ─────────────────────────────────────────────────
  getConsolidatedEntryIds(): Promise<string[]>;
  findEntriesToDecay(since: Date): Promise<IVaultEntry[]>;
  decayEntries(entryIds: { toString(): string }[]): Promise<number>;
  pruneDeadEntries(): Promise<number>;
  pruneDeadSynapses(): Promise<number>;
  findEntriesReadyForLTM(): Promise<IVaultEntry[]>;
  countEntries(): Promise<number>;
}
