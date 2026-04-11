import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoStorageAdapter } from "../MongoStorageAdapter.js";
import { VaultEntry } from "../models/VaultEntry.js";
import { Category } from "../models/Category.js";
import { Action } from "../models/Action.js";
import { ChatHistory } from "../models/ChatHistory.js";
import { LongTermMemory } from "../models/LongTermMemory.js";
import { Synapse } from "../models/Synapse.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let adapter: MongoStorageAdapter;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  adapter = new MongoStorageAdapter();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    VaultEntry.deleteMany({}),
    Category.deleteMany({}),
    Action.deleteMany({}),
    ChatHistory.deleteMany({}),
    LongTermMemory.deleteMany({}),
    Synapse.deleteMany({}),
  ]);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAnalysis(overrides = {}) {
  return {
    summary: "Test summary",
    strength: 5,
    isProcessed: true,
    ...overrides,
  };
}

async function seedEntry(userId = "user-1", rawText = "test entry", analysisOverrides = {}) {
  return adapter.createEntry(userId, rawText, makeAnalysis(analysisOverrides));
}

async function seedCategory(name = "Tech", order = 0) {
  return Category.create({ name, description: `${name} category`, order });
}

// ═══════════════════════════════════════════════════════════════════════════════
// createEntry / getEntryById
// ═══════════════════════════════════════════════════════════════════════════════

describe("createEntry", () => {
  it("returns entry with _id, userId, rawText", async () => {
    const entry = await seedEntry("user-1", "hello world");
    expect(entry._id).toBeDefined();
    expect(entry.userId).toBe("user-1");
    expect(entry.rawText).toBe("hello world");
  });

  it("stores analysis fields correctly", async () => {
    const entry = await seedEntry("user-1", "text", { summary: "my summary", strength: 7 });
    expect(entry.analysis?.summary).toBe("my summary");
    expect(entry.analysis?.strength).toBe(7);
  });

  it("sets isAnalyzed=false and isConsolidated=false by default", async () => {
    const entry = await seedEntry();
    expect(entry.isAnalyzed).toBe(false);
    expect(entry.isConsolidated).toBe(false);
  });
});

describe("getEntryById", () => {
  it("returns entry by id", async () => {
    const created = await seedEntry("user-1", "find me");
    const found = await adapter.getEntryById(created._id.toString());
    expect(found).not.toBeNull();
    expect(found!.rawText).toBe("find me");
  });

  it("returns null for non-existent id", async () => {
    const result = await adapter.getEntryById(new mongoose.Types.ObjectId().toString());
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteVaultEntry
// ═══════════════════════════════════════════════════════════════════════════════

describe("deleteVaultEntry", () => {
  it("deletes and returns the entry", async () => {
    const entry = await seedEntry("user-1", "delete me");
    const deleted = await adapter.deleteVaultEntry(entry._id.toString(), "user-1");
    expect(deleted).not.toBeNull();
    expect(deleted!.rawText).toBe("delete me");
  });

  it("returns null when entry does not exist", async () => {
    const result = await adapter.deleteVaultEntry(new mongoose.Types.ObjectId().toString(), "user-1");
    expect(result).toBeNull();
  });

  it("returns null when userId does not match", async () => {
    const entry = await seedEntry("user-1");
    const result = await adapter.deleteVaultEntry(entry._id.toString(), "user-2");
    expect(result).toBeNull();
    // entry still exists
    const still = await adapter.getEntryById(entry._id.toString());
    expect(still).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getVaultData
// ═══════════════════════════════════════════════════════════════════════════════

describe("getVaultData", () => {
  it("returns entries for the user", async () => {
    await seedEntry("user-1", "entry A");
    await seedEntry("user-1", "entry B");
    await seedEntry("user-2", "other user entry");
    const data = await adapter.getVaultData("user-1");
    expect(data.entries).toHaveLength(2);
  });

  it("returns empty arrays when user has no data", async () => {
    const data = await adapter.getVaultData("ghost-user");
    expect(data.entries).toHaveLength(0);
    expect(data.memories).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUniqueUserIds
// ═══════════════════════════════════════════════════════════════════════════════

describe("getUniqueUserIds", () => {
  it("returns distinct user ids", async () => {
    await seedEntry("user-A");
    await seedEntry("user-A");
    await seedEntry("user-B");
    const ids = await adapter.getUniqueUserIds();
    expect(ids).toHaveLength(2);
    expect(ids).toContain("user-A");
    expect(ids).toContain("user-B");
  });

  it("returns empty array when no entries", async () => {
    const ids = await adapter.getUniqueUserIds();
    expect(ids).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getActions / upsertAction
// ═══════════════════════════════════════════════════════════════════════════════

describe("upsertAction / getActions", () => {
  it("creates a new action", async () => {
    await adapter.upsertAction("SAVE_ONLY", "save info", true);
    const actions = await adapter.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe("SAVE_ONLY");
    expect(actions[0].description).toBe("save info");
  });

  it("updates existing action on upsert (same name)", async () => {
    await adapter.upsertAction("SAVE_ONLY", "old desc", true);
    await adapter.upsertAction("SAVE_ONLY", "new desc", true);
    const actions = await adapter.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].description).toBe("new desc");
  });

  it("only returns active actions", async () => {
    await Action.create({ name: "INACTIVE", description: "desc", isActive: false });
    await adapter.upsertAction("ACTIVE", "active action", false);
    const actions = await adapter.getActions();
    expect(actions.map(a => a.name)).not.toContain("INACTIVE");
    expect(actions.map(a => a.name)).toContain("ACTIVE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getChatHistory / appendChatMessage
// ═══════════════════════════════════════════════════════════════════════════════

describe("getChatHistory", () => {
  it("returns empty array when no history", async () => {
    const history = await adapter.getChatHistory("user-1");
    expect(history).toEqual([]);
  });

  it("returns messages after appending", async () => {
    await adapter.appendChatMessage("user-1", "user", "hello", 10);
    await adapter.appendChatMessage("user-1", "assistant", "hi there", 10);
    const history = await adapter.getChatHistory("user-1");
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "hello" });
    expect(history[1]).toEqual({ role: "assistant", content: "hi there" });
  });
});

describe("appendChatMessage", () => {
  it("creates chat doc on first message (upsert)", async () => {
    await adapter.appendChatMessage("new-user", "user", "first message", 10);
    const history = await adapter.getChatHistory("new-user");
    expect(history).toHaveLength(1);
  });

  it("respects maxMessages sliding window", async () => {
    for (let i = 0; i < 5; i++) {
      await adapter.appendChatMessage("user-1", "user", `msg ${i}`, 3);
    }
    const history = await adapter.getChatHistory("user-1");
    expect(history).toHaveLength(3);
    expect(history[0].content).toBe("msg 2");
    expect(history[2].content).toBe("msg 4");
  });

  it("keeps separate history per user", async () => {
    await adapter.appendChatMessage("user-A", "user", "A message", 10);
    await adapter.appendChatMessage("user-B", "user", "B message", 10);
    const histA = await adapter.getChatHistory("user-A");
    const histB = await adapter.getChatHistory("user-B");
    expect(histA).toHaveLength(1);
    expect(histB).toHaveLength(1);
    expect(histA[0].content).toBe("A message");
    expect(histB[0].content).toBe("B message");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findRelevantEntries
// ═══════════════════════════════════════════════════════════════════════════════

describe("findRelevantEntries", () => {
  it("finds entries matching keywords in rawText", async () => {
    await seedEntry("user-1", "I love Python language");
    await seedEntry("user-1", "I love Java language");
    const results = await adapter.findRelevantEntries("user-1", ["Python"]);
    expect(results).toHaveLength(1);
  });

  it("finds entries matching keywords in summary (case-insensitive)", async () => {
    await seedEntry("user-1", "raw", { summary: "All about Rust programming" });
    const results = await adapter.findRelevantEntries("user-1", ["rust"]);
    expect(results).toHaveLength(1);
  });

  it("does not return entries from other users", async () => {
    await seedEntry("user-2", "python tips", { tags: ["python"] });
    const results = await adapter.findRelevantEntries("user-1", ["python"]);
    expect(results).toHaveLength(0);
  });

  it("returns empty array when no match", async () => {
    await seedEntry("user-1", "golang notes");
    const results = await adapter.findRelevantEntries("user-1", ["python"]);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateEntryEmbedding / findSimilarEntries
// ═══════════════════════════════════════════════════════════════════════════════

describe("updateEntryEmbedding", () => {
  it("stores embedding on the entry", async () => {
    const entry = await seedEntry();
    await adapter.updateEntryEmbedding(entry._id.toString(), [0.1, 0.2, 0.3]);
    const found = await VaultEntry.findById(entry._id).lean();
    expect(found!.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("findSimilarEntries", () => {
  it("returns empty array when no entries have embeddings", async () => {
    await seedEntry();
    const results = await adapter.findSimilarEntries("user-1", [1, 0, 0]);
    expect(results).toHaveLength(0);
  });

  it("returns most similar entries by cosine similarity", async () => {
    const e1 = await seedEntry("user-1", "entry A");
    const e2 = await seedEntry("user-1", "entry B");
    const e3 = await seedEntry("user-1", "entry C");
    await adapter.updateEntryEmbedding(e1._id.toString(), [1, 0, 0]);
    await adapter.updateEntryEmbedding(e2._id.toString(), [0, 1, 0]);
    await adapter.updateEntryEmbedding(e3._id.toString(), [0.9, 0.1, 0]);

    // query closest to [1,0,0] — e1 and e3 should rank highest
    const results = await adapter.findSimilarEntries("user-1", [1, 0, 0], 2);
    expect(results).toHaveLength(2);
    const ids = results.map(r => r._id.toString());
    expect(ids).toContain(e1._id.toString());
    expect(ids).toContain(e3._id.toString());
  });

  it("respects topK limit", async () => {
    for (let i = 0; i < 5; i++) {
      const e = await seedEntry("user-1", `entry ${i}`);
      await adapter.updateEntryEmbedding(e._id.toString(), [i, 0, 0]);
    }
    const results = await adapter.findSimilarEntries("user-1", [1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// processSynapseLinks / getSynapsesBySource
// ═══════════════════════════════════════════════════════════════════════════════

describe("processSynapseLinks", () => {
  it("creates synapses and returns count", async () => {
    const e1 = await seedEntry("user-1", "entry 1");
    const e2 = await seedEntry("user-1", "entry 2");
    const id1 = e1._id.toString();
    const id2 = e2._id.toString();

    const count = await adapter.processSynapseLinks(
      [{ sourceId: id1, targetId: id2, reason: "related", strength: 8 }],
      new Set([id1]),
    );
    expect(count).toBe(1);
  });

  it("returns 0 when source not in deltaEntryIds", async () => {
    const e1 = await seedEntry("user-1", "A");
    const e2 = await seedEntry("user-1", "B");
    const count = await adapter.processSynapseLinks(
      [{ sourceId: e1._id.toString(), targetId: e2._id.toString(), reason: "x", strength: 5 }],
      new Set(["some-other-id"]),
    );
    expect(count).toBe(0);
  });

  it("does not create duplicate synapse (fires existing one)", async () => {
    const e1 = await seedEntry("user-1", "A");
    const e2 = await seedEntry("user-1", "B");
    const id1 = e1._id.toString();
    const id2 = e2._id.toString();
    const link = [{ sourceId: id1, targetId: id2, reason: "x", strength: 5 }];
    const deltaIds = new Set([id1]);

    await adapter.processSynapseLinks(link, deltaIds);
    const count2 = await adapter.processSynapseLinks(link, deltaIds);
    expect(count2).toBe(0); // already existed, not created
    const total = await Synapse.countDocuments();
    expect(total).toBe(1);
  });

  it("caps at MAX_SYNAPSES_PER_ENTRY (3) per source", async () => {
    const source = await seedEntry("user-1", "source");
    const targets = await Promise.all([
      seedEntry("user-1", "t1"),
      seedEntry("user-1", "t2"),
      seedEntry("user-1", "t3"),
      seedEntry("user-1", "t4"),
      seedEntry("user-1", "t5"),
    ]);
    const sourceId = source._id.toString();
    const links = targets.map((t, i) => ({
      sourceId,
      targetId: t._id.toString(),
      reason: `reason ${i}`,
      strength: i + 1,
    }));

    await adapter.processSynapseLinks(links, new Set([sourceId]));
    const count = await Synapse.countDocuments();
    expect(count).toBeLessThanOrEqual(3);
  });
});

describe("getSynapsesBySource", () => {
  it("returns synapses for entry sorted by weight desc", async () => {
    const e1 = await seedEntry("user-1", "source");
    const e2 = await seedEntry("user-1", "target A");
    const e3 = await seedEntry("user-1", "target B");
    const sourceId = e1._id.toString();

    await adapter.processSynapseLinks([
      { sourceId, targetId: e2._id.toString(), reason: "weak link", strength: 2 },
      { sourceId, targetId: e3._id.toString(), reason: "strong link", strength: 9 },
    ], new Set([sourceId]));

    const synapses = await adapter.getSynapsesBySource(sourceId, 10);
    expect(synapses).toHaveLength(2);
    expect(synapses[0].weight).toBeGreaterThanOrEqual(synapses[1].weight);
  });

  it("returns empty array when entry has no synapses", async () => {
    const e = await seedEntry();
    const synapses = await adapter.getSynapsesBySource(e._id.toString(), 10);
    expect(synapses).toHaveLength(0);
  });

  it("respects limit parameter", async () => {
    const source = await seedEntry("user-1", "src");
    const sourceId = source._id.toString();
    const targets = await Promise.all([
      seedEntry("user-1", "t1"),
      seedEntry("user-1", "t2"),
      seedEntry("user-1", "t3"),
    ]);
    const links = targets.map((t, i) => ({
      sourceId,
      targetId: t._id.toString(),
      reason: `r${i}`,
      strength: i + 1,
    }));
    await adapter.processSynapseLinks(links, new Set([sourceId]));

    const synapses = await adapter.getSynapsesBySource(sourceId, 2);
    expect(synapses).toHaveLength(2);
  });

  it("populates targetSummary and targetRawText from linked entry", async () => {
    const source = await seedEntry("user-1", "source entry");
    const target = await seedEntry("user-1", "target raw text", { summary: "target summary" });
    const sourceId = source._id.toString();

    await adapter.processSynapseLinks([
      { sourceId, targetId: target._id.toString(), reason: "linked", strength: 7 },
    ], new Set([sourceId]));

    const synapses = await adapter.getSynapsesBySource(sourceId, 10);
    expect(synapses[0].targetSummary).toBe("target summary");
    expect(synapses[0].targetRawText).toBe("target raw text");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findDeltaEntries / findContextEntries
// ═══════════════════════════════════════════════════════════════════════════════

describe("findDeltaEntries", () => {
  it("returns unanalyzed entries regardless of date", async () => {
    await VaultEntry.create({
      userId: "user-1",
      rawText: "unanalyzed",
      isAnalyzed: false,
      lastActivityAt: new Date("2020-01-01"),
    });
    const results = await adapter.findDeltaEntries("user-1", new Date());
    expect(results).toHaveLength(1);
  });

  it("returns entries active since given date", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 1000); // 1 second ago
    await VaultEntry.create({
      userId: "user-1",
      rawText: "recent",
      isAnalyzed: true,
      lastActivityAt: recent,
    });
    await VaultEntry.create({
      userId: "user-1",
      rawText: "old",
      isAnalyzed: true,
      lastActivityAt: new Date("2020-01-01"),
    });
    const since = new Date(now.getTime() - 5000); // 5 seconds ago
    const results = await adapter.findDeltaEntries("user-1", since);
    expect(results.map((e: any) => e.rawText)).toContain("recent");
    expect(results.map((e: any) => e.rawText)).not.toContain("old");
  });
});

describe("findContextEntries", () => {
  it("returns analyzed entries with strength >= 3 excluding given ids", async () => {
    const e1 = await seedEntry("user-1", "strong", { strength: 7 });
    const e2 = await seedEntry("user-1", "weak", { strength: 1 });
    await VaultEntry.updateOne({ _id: e1._id }, { isAnalyzed: true });
    await VaultEntry.updateOne({ _id: e2._id }, { isAnalyzed: true });

    const results = await adapter.findContextEntries("user-1", []);
    expect(results.map((e: any) => e.rawText)).toContain("strong");
    expect(results.map((e: any) => e.rawText)).not.toContain("weak");
  });

  it("excludes entries in excludeIds", async () => {
    const e1 = await seedEntry("user-1", "included", { strength: 7 });
    const e2 = await seedEntry("user-1", "excluded", { strength: 7 });
    await VaultEntry.updateMany({}, { isAnalyzed: true });

    const results = await adapter.findContextEntries("user-1", [e2._id.toString()]);
    const ids = results.map((e: any) => e._id.toString());
    expect(ids).toContain(e1._id.toString());
    expect(ids).not.toContain(e2._id.toString());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// applyTopicAnalysis
// ═══════════════════════════════════════════════════════════════════════════════

describe("applyTopicAnalysis", () => {
  it("sets isAnalyzed=true and increments strength", async () => {
    const e = await seedEntry("user-1", "text", { strength: 3 });
    await adapter.applyTopicAnalysis({
      topic: "ML",
      entryIds: [e._id.toString()],
      importance: 2,
    });
    const updated = await VaultEntry.findById(e._id).lean();
    expect(updated!.isAnalyzed).toBe(true);
    expect(updated!.analysis!.strength).toBe(5); // 3 + 2
  });

  it("returns number of updated entries", async () => {
    const e1 = await seedEntry();
    const e2 = await seedEntry();
    const count = await adapter.applyTopicAnalysis({
      topic: "t",
      entryIds: [e1._id.toString(), e2._id.toString()],
      importance: 1,
    });
    expect(count).toBe(2);
  });

  it("returns 0 when entryIds is empty", async () => {
    const count = await adapter.applyTopicAnalysis({
      topic: "t", entryIds: [], importance: 1,
    });
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findStrongEntries / upsertLTM / markConsolidated
// ═══════════════════════════════════════════════════════════════════════════════

describe("findStrongEntries", () => {
  it("returns entries with strength >= 10 and not consolidated", async () => {
    await seedEntry("user-1", "strong", { strength: 10 });
    await seedEntry("user-1", "weak", { strength: 5 });
    const results = await adapter.findStrongEntries("user-1");
    expect(results).toHaveLength(1);
    expect(results[0].rawText).toBe("strong");
  });

  it("excludes consolidated entries", async () => {
    const e = await seedEntry("user-1", "consolidated", { strength: 10 });
    await VaultEntry.updateOne({ _id: e._id }, { isConsolidated: true });
    const results = await adapter.findStrongEntries("user-1");
    expect(results).toHaveLength(0);
  });
});

describe("upsertLTM", () => {
  it("creates a new LTM record", async () => {
    const entry = await seedEntry("user-1", "python knowledge", { strength: 10 });
    await adapter.upsertLTM("user-1", "Python", { summary: "Python summary" }, [entry]);
    const ltm = await LongTermMemory.findOne({ userId: "user-1", topic: "Python" });
    expect(ltm).not.toBeNull();
    expect(ltm!.summary).toBe("Python summary");
  });

  it("updates existing LTM (same topic)", async () => {
    const e1 = await seedEntry("user-1", "entry1", { strength: 10 });
    await adapter.upsertLTM("user-1", "Python", { summary: "v1" }, [e1]);

    const e2 = await seedEntry("user-1", "entry2", { strength: 10 });
    await adapter.upsertLTM("user-1", "Python", { summary: "v2" }, [e2]);

    const ltm = await LongTermMemory.findOne({ userId: "user-1", topic: "Python" });
    expect(ltm!.summary).toBe("v2");
    const count = await LongTermMemory.countDocuments({ userId: "user-1", topic: "Python" });
    expect(count).toBe(1);
  });
});

describe("markConsolidated", () => {
  it("sets isConsolidated=true on given entries", async () => {
    const e1 = await seedEntry("user-1", "e1");
    const e2 = await seedEntry("user-1", "e2");
    await adapter.markConsolidated([e1, e2]);
    const updated = await VaultEntry.find({ _id: { $in: [e1._id, e2._id] } }).lean();
    expect(updated.every(e => e.isConsolidated)).toBe(true);
  });

  it("does not affect other entries", async () => {
    const e1 = await seedEntry("user-1", "mark");
    const e2 = await seedEntry("user-1", "leave");
    await adapter.markConsolidated([e1]);
    const untouched = await VaultEntry.findById(e2._id).lean();
    expect(untouched!.isConsolidated).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Subconscious: getConsolidatedEntryIds / findEntriesToDecay / decayEntries
//               pruneDeadEntries / pruneDeadSynapses / findEntriesReadyForLTM / countEntries
// ═══════════════════════════════════════════════════════════════════════════════

describe("getConsolidatedEntryIds", () => {
  it("returns entry ids referenced in LTM sourceEntryIds", async () => {
    const e1 = await seedEntry("user-1", "consolidated entry");
    await LongTermMemory.create({
      userId: "user-1",
      summary: "s",
      tags: [],
      topic: "t",
      sourceEntryIds: [new mongoose.Types.ObjectId(e1._id.toString())],
    });
    const ids = await adapter.getConsolidatedEntryIds();
    expect(ids).toContain(e1._id.toString());
  });

  it("returns empty array when no LTM records", async () => {
    const ids = await adapter.getConsolidatedEntryIds();
    expect(ids).toHaveLength(0);
  });
});

describe("findEntriesToDecay", () => {
  it("returns non-consolidated entries with strength > 0 and lastActivityAt < since", async () => {
    const old = new Date("2020-01-01");
    await VaultEntry.create({
      userId: "user-1",
      rawText: "old entry",
      isConsolidated: false,
      lastActivityAt: old,
      analysis: { strength: 3 },
    });
    const since = new Date();
    const results = await adapter.findEntriesToDecay(since);
    expect(results).toHaveLength(1);
  });

  it("excludes consolidated entries", async () => {
    await VaultEntry.create({
      userId: "user-1",
      rawText: "consolidated",
      isConsolidated: true,
      lastActivityAt: new Date("2020-01-01"),
      analysis: { strength: 5 },
    });
    const results = await adapter.findEntriesToDecay(new Date());
    expect(results).toHaveLength(0);
  });

  it("excludes entries with strength 0", async () => {
    await VaultEntry.create({
      userId: "user-1",
      rawText: "dead",
      isConsolidated: false,
      lastActivityAt: new Date("2020-01-01"),
      analysis: { strength: 0 },
    });
    const results = await adapter.findEntriesToDecay(new Date());
    expect(results).toHaveLength(0);
  });
});

describe("decayEntries", () => {
  it("decrements strength by 1 for each entry", async () => {
    const e = await seedEntry("user-1", "text", { strength: 5 });
    await adapter.decayEntries([{ toString: () => e._id.toString() }]);
    const updated = await VaultEntry.findById(e._id).lean();
    expect(updated!.analysis!.strength).toBe(4);
  });

  it("returns number of modified entries", async () => {
    const e1 = await seedEntry("user-1", "a", { strength: 5 });
    const e2 = await seedEntry("user-1", "b", { strength: 3 });
    const count = await adapter.decayEntries([
      { toString: () => e1._id.toString() },
      { toString: () => e2._id.toString() },
    ]);
    expect(count).toBe(2);
  });

  it("returns 0 when given empty array", async () => {
    const count = await adapter.decayEntries([]);
    expect(count).toBe(0);
  });
});

describe("pruneDeadEntries", () => {
  it("deletes non-consolidated entries with strength <= 0", async () => {
    await VaultEntry.create({
      userId: "user-1", rawText: "dead", isConsolidated: false,
      analysis: { strength: 0 },
    });
    await seedEntry("user-1", "alive", { strength: 3 });
    const count = await adapter.pruneDeadEntries();
    expect(count).toBe(1);
    expect(await VaultEntry.countDocuments()).toBe(1);
  });

  it("does not delete consolidated entries with strength 0", async () => {
    await VaultEntry.create({
      userId: "user-1", rawText: "consolidated dead", isConsolidated: true,
      analysis: { strength: 0 },
    });
    const count = await adapter.pruneDeadEntries();
    expect(count).toBe(0);
  });
});

describe("pruneDeadSynapses", () => {
  it("deletes synapses with weight <= 0.1", async () => {
    const e1 = await seedEntry("user-1", "A");
    const e2 = await seedEntry("user-1", "B");
    await Synapse.create({
      from: new mongoose.Types.ObjectId(e1._id.toString()),
      to: new mongoose.Types.ObjectId(e2._id.toString()),
      weight: 0.05,
      stability: 0.5,
    });
    const count = await adapter.pruneDeadSynapses();
    expect(count).toBe(1);
    expect(await Synapse.countDocuments()).toBe(0);
  });

  it("keeps synapses with weight > 0.1", async () => {
    const e1 = await seedEntry("user-1", "A");
    const e2 = await seedEntry("user-1", "B");
    await Synapse.create({
      from: new mongoose.Types.ObjectId(e1._id.toString()),
      to: new mongoose.Types.ObjectId(e2._id.toString()),
      weight: 0.5,
      stability: 0.5,
    });
    const count = await adapter.pruneDeadSynapses();
    expect(count).toBe(0);
  });
});

describe("findEntriesReadyForLTM", () => {
  it("returns non-consolidated entries with strength >= 10", async () => {
    await seedEntry("user-1", "ready", { strength: 10 });
    await seedEntry("user-1", "not ready", { strength: 5 });
    const results = await adapter.findEntriesReadyForLTM();
    expect(results).toHaveLength(1);
  });

  it("excludes consolidated entries", async () => {
    const e = await seedEntry("user-1", "consolidated", { strength: 10 });
    await VaultEntry.updateOne({ _id: e._id }, { isConsolidated: true });
    const results = await adapter.findEntriesReadyForLTM();
    expect(results).toHaveLength(0);
  });
});

describe("countEntries", () => {
  it("returns total number of vault entries", async () => {
    await seedEntry("user-1");
    await seedEntry("user-1");
    await seedEntry("user-2");
    const count = await adapter.countEntries();
    expect(count).toBe(3);
  });

  it("returns 0 when no entries", async () => {
    const count = await adapter.countEntries();
    expect(count).toBe(0);
  });
});
