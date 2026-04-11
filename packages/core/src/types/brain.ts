// ═══════════════════════════════════════════════════════════════════════════════
// SHARED BRAIN DOMAIN TYPES
// Kept here to avoid circular imports between conscious.processor and adapters.
// ═══════════════════════════════════════════════════════════════════════════════

export interface TopicAnalysis {
  topic: string;
  entryIds: string[];
  tags: string[];
  importance: number; // 1-10
}

export interface LongTermMemoryData {
  summary: string;
  tags: string[];
}

// ─── Domain entity interfaces (framework-level, no mongoose dependency) ───────

export interface IVaultEntry {
  _id: { toString(): string };
  userId: string;
  rawText: string;
  analysis?: {
    summary: string;
    tags: string[];
    strength: number;
    isProcessed: boolean;
  };
  embedding?: number[];
  isAnalyzed: boolean;
  isConsolidated: boolean;
  isPermanent: boolean;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILongTermMemory {
  _id: { toString(): string };
  userId: string;
  summary: string | null;
  tags: string[];
  strength: number;
  sourceEntryIds: { toString(): string }[];
  topic: string | null;
  createdAt: Date;
  updatedAt: Date;
}

