import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type {
  IStorageAdapter,
  ActionInfo,
  EntryAnalysisData,
  IVaultEntry,
  ILongTermMemory,
  TopicAnalysis,
  LongTermMemoryData,
} from "@the-brain/core";

// ═══════════════════════════════════════════════════════════════════════════════
// SQLITE STORAGE ADAPTER
// Single-file database. Embeddings stored as JSON, cosine similarity in JS.
// No server required. Full semantic search support.
// ═══════════════════════════════════════════════════════════════════════════════

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function toVaultEntry(row: Record<string, unknown>): IVaultEntry {
  const id = String(row.id);
  return {
    _id: { toString: () => id },
    userId: String(row.userId),
    rawText: String(row.rawText),
    analysis: row.summary ? {
      summary: String(row.summary),
      strength: Number(row.strength ?? 5),
      isProcessed: Boolean(row.isProcessed),
    } : undefined,
    embedding: row.embedding ? JSON.parse(String(row.embedding)) : undefined,
    isAnalyzed: Boolean(row.isAnalyzed),
    isConsolidated: Boolean(row.isConsolidated),
    isPermanent: Boolean(row.isPermanent),
    lastActivityAt: new Date(String(row.lastActivityAt)),
    createdAt: new Date(String(row.createdAt)),
    updatedAt: new Date(String(row.updatedAt)),
  };
}

export class SQLiteStorageAdapter implements IStorageAdapter {
  private db: DatabaseSync;

  constructor(storagePath = "./.brain") {
    mkdirSync(storagePath, { recursive: true });
    this.db = new DatabaseSync(join(storagePath, "brain.db"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vault_entries (
        id            TEXT PRIMARY KEY,
        userId        TEXT NOT NULL,
        rawText       TEXT NOT NULL,
        summary       TEXT,
        strength      REAL DEFAULT 5,
        isProcessed   INTEGER DEFAULT 0,
        isAnalyzed    INTEGER DEFAULT 0,
        isConsolidated INTEGER DEFAULT 0,
        isPermanent   INTEGER DEFAULT 0,
        embedding     TEXT,
        lastActivityAt TEXT NOT NULL,
        createdAt     TEXT NOT NULL,
        updatedAt     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS synapses (
        id        TEXT PRIMARY KEY,
        sourceId  TEXT NOT NULL,
        targetId  TEXT NOT NULL,
        weight    REAL DEFAULT 1,
        reason    TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        UNIQUE(sourceId, targetId)
      );

      CREATE TABLE IF NOT EXISTS long_term_memories (
        id           TEXT PRIMARY KEY,
        userId       TEXT NOT NULL,
        topic        TEXT,
        summary      TEXT,
        strength     REAL DEFAULT 5,
        sourceEntryIds TEXT DEFAULT '[]',
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS actions (
        name        TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        isBuiltIn   INTEGER DEFAULT 0,
        isActive    INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS chat_history (
        userId    TEXT PRIMARY KEY,
        messages  TEXT DEFAULT '[]',
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        userId    TEXT PRIMARY KEY,
        profile   TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  // ─── Entry CRUD ───────────────────────────────────────────────────────────

  async createEntry(userId: string, rawText: string, analysis: EntryAnalysisData): Promise<IVaultEntry> {
    const id = uid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO vault_entries (id, userId, rawText, summary, strength, isProcessed, isAnalyzed, isPermanent, lastActivityAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      id, userId, rawText,
      analysis.summary,
      analysis.strength,
      analysis.isProcessed ? 1 : 0,
      analysis.isPermanent ? 1 : 0,
      now, now, now,
    );
    return toVaultEntry(this.db.prepare("SELECT * FROM vault_entries WHERE id = ?").get(id) as Record<string, unknown>);
  }

  async getEntryById(entryId: string): Promise<IVaultEntry | null> {
    const row = this.db.prepare("SELECT * FROM vault_entries WHERE id = ?").get(entryId);
    return row ? toVaultEntry(row as Record<string, unknown>) : null;
  }

  // ─── Vault ────────────────────────────────────────────────────────────────

  async getVaultData(userId: string): Promise<{ entries: IVaultEntry[]; memories: ILongTermMemory[] }> {
    const entries = (this.db.prepare("SELECT * FROM vault_entries WHERE userId = ? ORDER BY createdAt DESC").all(userId) as Record<string, unknown>[]).map(toVaultEntry);

    const memories = (this.db.prepare("SELECT * FROM long_term_memories WHERE userId = ?").all(userId) as Record<string, unknown>[]).map(row => ({
      _id: { toString: () => String(row.id) },
      userId: String(row.userId),
      summary: row.summary ? String(row.summary) : null,
      strength: Number(row.strength ?? 5),
      sourceEntryIds: JSON.parse(String(row.sourceEntryIds ?? "[]")).map((id: string) => ({ toString: () => id })),
      topic: row.topic ? String(row.topic) : null,
      createdAt: new Date(String(row.createdAt)),
      updatedAt: new Date(String(row.updatedAt)),
    } as ILongTermMemory));

    return { entries, memories };
  }

  async deleteVaultEntry(entryId: string, userId: string): Promise<IVaultEntry | null> {
    const entry = await this.getEntryById(entryId);
    if (!entry || entry.userId !== userId) return null;
    this.db.prepare("DELETE FROM vault_entries WHERE id = ? AND userId = ?").run(entryId, userId);
    this.db.prepare("DELETE FROM synapses WHERE sourceId = ? OR targetId = ?").run(entryId, entryId);
    return entry;
  }

  // ─── Shared ───────────────────────────────────────────────────────────────


  async getUniqueUserIds(): Promise<string[]> {
    return (this.db.prepare("SELECT DISTINCT userId FROM vault_entries").all() as { userId: string }[]).map(r => r.userId);
  }

  async getActions(): Promise<ActionInfo[]> {
    return (this.db.prepare("SELECT name, description FROM actions WHERE isActive = 1").all() as Record<string, unknown>[]).map(r => ({
      name: String(r.name),
      description: String(r.description),
    }));
  }

  async upsertAction(name: string, description: string, isBuiltIn = false): Promise<void> {
    this.db.prepare(`
      INSERT INTO actions (name, description, isBuiltIn, isActive) VALUES (?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET description = excluded.description, isActive = 1
    `).run(name, description, isBuiltIn ? 1 : 0);
  }

  async removeAction(name: string): Promise<void> {
    this.db.prepare(`DELETE FROM actions WHERE name = ? AND isBuiltIn = 0`).run(name);
  }

  // ─── Chat History ─────────────────────────────────────────────────────────

  async getChatHistory(userId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
    const row = this.db.prepare("SELECT messages FROM chat_history WHERE userId = ?").get(userId) as { messages: string } | undefined;
    return row ? JSON.parse(row.messages) : [];
  }

  async appendChatMessage(userId: string, role: "user" | "assistant", content: string, maxMessages: number): Promise<void> {
    const history = await this.getChatHistory(userId);
    history.push({ role, content });
    const trimmed = history.slice(-maxMessages);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO chat_history (userId, messages, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET messages = excluded.messages, updatedAt = excluded.updatedAt
    `).run(userId, JSON.stringify(trimmed), now);
  }

  // ─── User Profile ─────────────────────────────────────────────────────────

  async getUserProfile(userId: string): Promise<string | null> {
    const row = this.db.prepare("SELECT profile FROM user_profiles WHERE userId = ?").get(userId) as { profile: string } | undefined;
    return row?.profile ?? null;
  }

  async upsertUserProfile(userId: string, profile: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO user_profiles (userId, profile, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET profile = excluded.profile, updatedAt = excluded.updatedAt
    `).run(userId, profile, now);
  }

  // ─── Intent Context ───────────────────────────────────────────────────────

  async findRelevantEntries(userId: string, keywords: string[]): Promise<IVaultEntry[]> {
    if (keywords.length === 0) return [];
    const conditions = keywords.map(() => "(rawText LIKE ? OR summary LIKE ?)").join(" OR ");
    const params = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);
    const rows = this.db.prepare(
      `SELECT * FROM vault_entries WHERE userId = ? AND (${conditions}) ORDER BY strength DESC LIMIT 10`
    ).all(userId, ...params) as Record<string, unknown>[];
    return rows.map(toVaultEntry);
  }

  async findSimilarEntries(userId: string, embedding: number[], topK = 3): Promise<IVaultEntry[]> {
    const rows = this.db.prepare(
      "SELECT * FROM vault_entries WHERE userId = ? AND embedding IS NOT NULL"
    ).all(userId) as Record<string, unknown>[];

    return rows
      .map(row => ({
        entry: toVaultEntry(row),
        score: cosineSimilarity(embedding, JSON.parse(String(row.embedding))),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(r => r.entry);
  }

  async updateEntryEmbedding(entryId: string, embedding: number[]): Promise<void> {
    this.db.prepare("UPDATE vault_entries SET embedding = ?, updatedAt = ? WHERE id = ?")
      .run(JSON.stringify(embedding), new Date().toISOString(), entryId);
  }

  // ─── Conscious Processor ──────────────────────────────────────────────────

  async findDeltaEntries(userId: string, since: Date): Promise<IVaultEntry[]> {
    const rows = this.db.prepare(
      "SELECT * FROM vault_entries WHERE userId = ? AND isAnalyzed = 1 AND isConsolidated = 0 AND updatedAt > ? LIMIT 50"
    ).all(userId, since.toISOString()) as Record<string, unknown>[];
    return rows.map(toVaultEntry);
  }

  async findContextEntries(userId: string, excludeIds: string[]): Promise<IVaultEntry[]> {
    if (excludeIds.length === 0) {
      const rows = this.db.prepare(
        "SELECT * FROM vault_entries WHERE userId = ? ORDER BY strength DESC LIMIT 20"
      ).all(userId) as Record<string, unknown>[];
      return rows.map(toVaultEntry);
    }
    const placeholders = excludeIds.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT * FROM vault_entries WHERE userId = ? AND id NOT IN (${placeholders}) ORDER BY strength DESC LIMIT 20`
    ).all(userId, ...excludeIds) as Record<string, unknown>[];
    return rows.map(toVaultEntry);
  }

  async applyTopicAnalysis(topic: TopicAnalysis): Promise<number> {
    const stmt = this.db.prepare(
      "UPDATE vault_entries SET isAnalyzed = 1, strength = strength + ?, updatedAt = ? WHERE id = ?"
    );
    const now = new Date().toISOString();
    const importance = topic.importance ?? 1;
    let updated = 0;
    for (const id of topic.entryIds) {
      const result = stmt.run(importance, now, id) as { changes: number };
      updated += result.changes;
    }
    return updated;
  }

  async findStrongEntries(userId: string): Promise<IVaultEntry[]> {
    const rows = this.db.prepare(
      "SELECT * FROM vault_entries WHERE userId = ? AND strength >= 10 AND isConsolidated = 0"
    ).all(userId) as Record<string, unknown>[];
    return rows.map(toVaultEntry);
  }

  async upsertLTM(userId: string, topic: string, memoryData: LongTermMemoryData, entries: IVaultEntry[]): Promise<void> {
    const id = uid();
    const now = new Date().toISOString();
    const entryIds = JSON.stringify(entries.map(e => e._id.toString()));
    this.db.prepare(`
      INSERT INTO long_term_memories (id, userId, topic, summary, sourceEntryIds, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(id, userId, topic, memoryData.summary, entryIds, now, now);
  }

  async markConsolidated(entries: IVaultEntry[]): Promise<void> {
    const stmt = this.db.prepare("UPDATE vault_entries SET isConsolidated = 1, updatedAt = ? WHERE id = ?");
    const now = new Date().toISOString();
    for (const entry of entries) {
      stmt.run(now, entry._id.toString());
    }
  }

  // ─── Synapse Queries & Management ────────────────────────────────────────

  async getSynapsesBySource(entryId: string, limit: number): Promise<{ targetId: string; weight: number; reason: string; targetSummary?: string; targetRawText?: string }[]> {
    const rows = this.db.prepare(`
      SELECT s.targetId, s.weight, s.reason, v.summary AS targetSummary, v.rawText AS targetRawText
      FROM synapses s
      LEFT JOIN vault_entries v ON v.id = s.targetId
      WHERE s.sourceId = ?
      ORDER BY s.weight DESC
      LIMIT ?
    `).all(entryId, limit) as Record<string, unknown>[];

    return rows.map(row => ({
      targetId: String(row.targetId),
      weight: Number(row.weight),
      reason: String(row.reason),
      targetSummary: row.targetSummary ? String(row.targetSummary) : undefined,
      targetRawText: row.targetRawText ? String(row.targetRawText) : undefined,
    }));
  }

  async processSynapseLinks(synapses: { sourceId: string; targetId: string; reason: string; strength: number }[], deltaEntryIds: Set<string>): Promise<number> {
    const now = new Date().toISOString();
    let created = 0;
    const upsert = this.db.prepare(`
      INSERT INTO synapses (id, sourceId, targetId, weight, reason, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    for (const s of synapses) {
      if (s.sourceId === s.targetId) continue;
      if (!deltaEntryIds.has(s.sourceId) && !deltaEntryIds.has(s.targetId)) continue;
      upsert.run(uid(), s.sourceId, s.targetId, s.strength, s.reason, now);
      created++;
    }
    return created;
  }

  // ─── Subconscious Routine ─────────────────────────────────────────────────

  async getConsolidatedEntryIds(): Promise<string[]> {
    return (this.db.prepare("SELECT id FROM vault_entries WHERE isConsolidated = 1").all() as { id: string }[]).map(r => r.id);
  }

  async findEntriesToDecay(since: Date): Promise<IVaultEntry[]> {
    const rows = this.db.prepare(
      "SELECT * FROM vault_entries WHERE lastActivityAt < ? AND strength > 0 AND isPermanent = 0"
    ).all(since.toISOString()) as Record<string, unknown>[];
    return rows.map(toVaultEntry);
  }

  async decayEntries(entryIds: { toString(): string }[]): Promise<number> {
    const stmt = this.db.prepare(
      "UPDATE vault_entries SET strength = MAX(0, strength - 1), updatedAt = ? WHERE id = ?"
    );
    const now = new Date().toISOString();
    for (const id of entryIds) {
      stmt.run(now, id.toString());
    }
    return entryIds.length;
  }

  async pruneDeadEntries(): Promise<number> {
    const result = this.db.prepare("DELETE FROM vault_entries WHERE strength <= 0 AND isPermanent = 0").run();
    return Number(result.changes);
  }

  async pruneDeadSynapses(): Promise<number> {
    const result = this.db.prepare(`
      DELETE FROM synapses WHERE sourceId NOT IN (SELECT id FROM vault_entries)
        OR targetId NOT IN (SELECT id FROM vault_entries)
    `).run();
    return Number(result.changes);
  }

  async findEntriesReadyForLTM(): Promise<IVaultEntry[]> {
    const rows = this.db.prepare(
      "SELECT * FROM vault_entries WHERE strength >= 10 AND isConsolidated = 0"
    ).all() as Record<string, unknown>[];
    return rows.map(toVaultEntry);
  }

  async countEntries(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM vault_entries").get() as { count: number };
    return row.count;
  }
}
