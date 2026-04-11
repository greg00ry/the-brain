// ═══════════════════════════════════════════════════════════════════════════════
// SHARED BRAIN DOMAIN TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface TopicAnalysis {
  topic: string;
  entryIds: string[];
  importance: number; // 1-10
}

// ─── Domain entity interfaces (framework-level, no mongoose dependency) ───────

export interface IVaultEntry {
  _id: { toString(): string };
  userId: string;
  rawText: string;
  analysis?: {
    summary: string;
    strength: number;
    isProcessed: boolean;
  };
  embedding?: number[];
  isAnalyzed: boolean;
  isPermanent: boolean;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
