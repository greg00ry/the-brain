import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SQLiteStorageAdapter } from "../SQLiteStorageAdapter.js";

const TEST_DIR = join(process.cwd(), ".brain-sqlite-test");

function makeAdapter() {
  return new SQLiteStorageAdapter(TEST_DIR);
}

function makeAnalysis(overrides = {}) {
  return {
    summary: "Test summary",
    strength: 5,
    isProcessed: true,
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

// ─── Entry CRUD ───────────────────────────────────────────────────────────────

describe("createEntry / getEntryById", () => {
  it("creates an entry and retrieves it by id", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "I prefer TypeScript", makeAnalysis());
    const found = await s.getEntryById(entry._id.toString());
    expect(found).not.toBeNull();
    expect(found?.rawText).toBe("I prefer TypeScript");
    expect(found?.analysis?.strength).toBe(5);
    expect(found?.isAnalyzed).toBe(true);
  });

  it("returns null for unknown id", async () => {
    const s = makeAdapter();
    expect(await s.getEntryById("nonexistent")).toBeNull();
  });

  it("sets timestamps on creation", async () => {
    const before = new Date();
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "test", makeAnalysis());
    const after = new Date();
    expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entry.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ─── Actions ──────────────────────────────────────────────────────────────────

describe("upsertAction / getActions", () => {
  it("inserts and retrieves actions", async () => {
    const s = makeAdapter();
    await s.upsertAction("SAVE_ONLY", "save stuff", true);
    await s.upsertAction("RESEARCH_BRAIN", "recall stuff", true);
    const actions = await s.getActions();
    expect(actions.map(a => a.name)).toContain("SAVE_ONLY");
    expect(actions.map(a => a.name)).toContain("RESEARCH_BRAIN");
  });

  it("updates description on duplicate name", async () => {
    const s = makeAdapter();
    await s.upsertAction("SAVE_ONLY", "old description", true);
    await s.upsertAction("SAVE_ONLY", "new description", true);
    const actions = await s.getActions();
    const action = actions.find(a => a.name === "SAVE_ONLY");
    expect(action?.description).toBe("new description");
  });

  it("does not duplicate on repeated upsert", async () => {
    const s = makeAdapter();
    await s.upsertAction("SAVE_ONLY", "desc", true);
    await s.upsertAction("SAVE_ONLY", "desc", true);
    await s.upsertAction("SAVE_ONLY", "desc", true);
    const actions = await s.getActions();
    expect(actions.filter(a => a.name === "SAVE_ONLY")).toHaveLength(1);
  });
});

// ─── Embeddings & Semantic Search ─────────────────────────────────────────────

describe("updateEntryEmbedding / findSimilarEntries", () => {
  it("stores embeddings and finds similar entries via cosine similarity", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "I love TypeScript", makeAnalysis());
    const e2 = await s.createEntry("user-1", "I enjoy coffee", makeAnalysis());
    await s.updateEntryEmbedding(e1._id.toString(), [1, 0, 0]);
    await s.updateEntryEmbedding(e2._id.toString(), [0, 1, 0]);
    const results = await s.findSimilarEntries("user-1", [0.99, 0.1, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0].rawText).toBe("I love TypeScript");
  });

  it("returns topK results sorted by similarity", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "entry A", makeAnalysis());
    const e2 = await s.createEntry("user-1", "entry B", makeAnalysis());
    const e3 = await s.createEntry("user-1", "entry C", makeAnalysis());
    await s.updateEntryEmbedding(e1._id.toString(), [1, 0, 0]);
    await s.updateEntryEmbedding(e2._id.toString(), [0.9, 0.1, 0]);
    await s.updateEntryEmbedding(e3._id.toString(), [0, 1, 0]);
    const results = await s.findSimilarEntries("user-1", [1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].rawText).toBe("entry A");
    expect(results[1].rawText).toBe("entry B");
  });

  it("returns empty array when no embeddings stored", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "no embedding", makeAnalysis());
    expect(await s.findSimilarEntries("user-1", [1, 0, 0])).toHaveLength(0);
  });

  it("does not return entries from other users", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-2", "other user entry", makeAnalysis());
    await s.updateEntryEmbedding(e._id.toString(), [1, 0, 0]);
    expect(await s.findSimilarEntries("user-1", [1, 0, 0])).toHaveLength(0);
  });
});

// ─── Keyword Search ───────────────────────────────────────────────────────────

describe("findRelevantEntries", () => {
  it("finds entries matching keywords in rawText", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "TypeScript is great for large projects", makeAnalysis());
    await s.createEntry("user-1", "I enjoy cooking pasta", makeAnalysis());
    const results = await s.findRelevantEntries("user-1", ["TypeScript"]);
    expect(results).toHaveLength(1);
    expect(results[0].rawText).toContain("TypeScript");
  });

  it("finds entries matching keywords in summary", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "raw text here", makeAnalysis({ summary: "Python preference noted" }));
    const results = await s.findRelevantEntries("user-1", ["Python"]);
    expect(results).toHaveLength(1);
  });

  it("returns empty for no keyword match", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "I like coffee", makeAnalysis());
    expect(await s.findRelevantEntries("user-1", ["quantum"])).toHaveLength(0);
  });

  it("returns empty for empty keywords array", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "some entry", makeAnalysis());
    expect(await s.findRelevantEntries("user-1", [])).toHaveLength(0);
  });
});

// ─── Chat History ─────────────────────────────────────────────────────────────

describe("chat history", () => {
  it("appends messages and respects sliding window", async () => {
    const s = makeAdapter();
    for (let i = 0; i < 12; i++) {
      await s.appendChatMessage("user-1", i % 2 === 0 ? "user" : "assistant", `msg ${i}`, 10);
    }
    const history = await s.getChatHistory("user-1");
    expect(history.length).toBe(10);
    expect(history[0].content).toBe("msg 2");
    expect(history[9].content).toBe("msg 11");
  });

  it("returns empty array for new user", async () => {
    const s = makeAdapter();
    expect(await s.getChatHistory("nobody")).toHaveLength(0);
  });

  it("isolates chat history per user", async () => {
    const s = makeAdapter();
    await s.appendChatMessage("user-1", "user", "hello from user-1", 10);
    await s.appendChatMessage("user-2", "user", "hello from user-2", 10);
    const h1 = await s.getChatHistory("user-1");
    const h2 = await s.getChatHistory("user-2");
    expect(h1[0].content).toBe("hello from user-1");
    expect(h2[0].content).toBe("hello from user-2");
  });

  it("preserves role correctly", async () => {
    const s = makeAdapter();
    await s.appendChatMessage("user-1", "user", "question", 10);
    await s.appendChatMessage("user-1", "assistant", "answer", 10);
    const history = await s.getChatHistory("user-1");
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });
});

// ─── Vault ────────────────────────────────────────────────────────────────────

describe("getVaultData / deleteVaultEntry", () => {
  it("returns all entries for user", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "entry 1", makeAnalysis());
    await s.createEntry("user-1", "entry 2", makeAnalysis());
    await s.createEntry("user-2", "other user", makeAnalysis());
    const { entries } = await s.getVaultData("user-1");
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.userId === "user-1")).toBe(true);
  });

  it("deletes an entry and its id", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "to delete", makeAnalysis());
    const deleted = await s.deleteVaultEntry(entry._id.toString(), "user-1");
    expect(deleted).not.toBeNull();
    expect(await s.getEntryById(entry._id.toString())).toBeNull();
  });

  it("returns null when deleting entry of wrong user", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "protected", makeAnalysis());
    const result = await s.deleteVaultEntry(entry._id.toString(), "user-2");
    expect(result).toBeNull();
    expect(await s.getEntryById(entry._id.toString())).not.toBeNull();
  });
});

// ─── Subconscious: Decay & Pruning ────────────────────────────────────────────

describe("decay / pruning (subconscious routine)", () => {
  it("decays entry strength by 1", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "old note", makeAnalysis({ strength: 3 }));
    await s.decayEntries([entry._id]);
    const updated = await s.getEntryById(entry._id.toString());
    expect(updated?.analysis?.strength).toBe(2);
  });

  it("does not decay below 0", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "dying note", makeAnalysis({ strength: 0 }));
    await s.decayEntries([entry._id]);
    const updated = await s.getEntryById(entry._id.toString());
    expect(updated?.analysis?.strength).toBe(0);
  });

  it("prunes entries with strength <= 0", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "dead entry", makeAnalysis({ strength: 0 }));
    await s.createEntry("user-1", "alive entry", makeAnalysis({ strength: 5 }));
    const pruned = await s.pruneDeadEntries();
    expect(pruned).toBe(1);
    expect(await s.countEntries()).toBe(1);
  });

  it("findEntriesToDecay returns entries inactive before given date", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "old entry", makeAnalysis());
    const future = new Date(Date.now() + 60_000);
    const toDecay = await s.findEntriesToDecay(future);
    expect(toDecay.length).toBeGreaterThan(0);
  });

  it("findEntriesToDecay excludes entries with strength 0", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "already dead", makeAnalysis({ strength: 0 }));
    const future = new Date(Date.now() + 60_000);
    const toDecay = await s.findEntriesToDecay(future);
    expect(toDecay).toHaveLength(0);
  });

  it("pruneDeadSynapses removes synapses for deleted entries", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "source", makeAnalysis());
    const e2 = await s.createEntry("user-1", "target", makeAnalysis({ strength: 0 }));
    const deltaIds = new Set([e1._id.toString(), e2._id.toString()]);
    await s.processSynapseLinks([{
      sourceId: e1._id.toString(),
      targetId: e2._id.toString(),
      reason: "related",
      strength: 0.8,
    }], deltaIds);
    await s.pruneDeadEntries();
    const pruned = await s.pruneDeadSynapses();
    expect(pruned).toBe(1);
  });

});

// ─── Synapses ─────────────────────────────────────────────────────────────────

describe("processSynapseLinks / getSynapsesBySource", () => {
  it("creates synapses between delta entries", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "Python async", makeAnalysis());
    const e2 = await s.createEntry("user-1", "event loop", makeAnalysis());
    const deltaIds = new Set([e1._id.toString(), e2._id.toString()]);
    const created = await s.processSynapseLinks([{
      sourceId: e1._id.toString(),
      targetId: e2._id.toString(),
      reason: "related concepts",
      strength: 0.9,
    }], deltaIds);
    expect(created).toBe(1);
    const synapses = await s.getSynapsesBySource(e1._id.toString(), 10);
    expect(synapses).toHaveLength(1);
    expect(synapses[0].targetId).toBe(e2._id.toString());
    expect(synapses[0].reason).toBe("related concepts");
  });

  it("skips synapse if neither entry is in delta", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "A", makeAnalysis());
    const e2 = await s.createEntry("user-1", "B", makeAnalysis());
    const created = await s.processSynapseLinks([{
      sourceId: e1._id.toString(),
      targetId: e2._id.toString(),
      reason: "test",
      strength: 0.5,
    }], new Set());
    expect(created).toBe(0);
  });

  it("does not duplicate synapses on repeated calls", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "A", makeAnalysis());
    const e2 = await s.createEntry("user-1", "B", makeAnalysis());
    const deltaIds = new Set([e1._id.toString()]);
    const link = [{ sourceId: e1._id.toString(), targetId: e2._id.toString(), reason: "r", strength: 0.5 }];
    await s.processSynapseLinks(link, deltaIds);
    await s.processSynapseLinks(link, deltaIds);
    const synapses = await s.getSynapsesBySource(e1._id.toString(), 10);
    expect(synapses).toHaveLength(1);
  });

  it("getSynapsesBySource includes target entry text", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "source entry", makeAnalysis());
    const e2 = await s.createEntry("user-1", "target entry", makeAnalysis({ summary: "target summary" }));
    const deltaIds = new Set([e1._id.toString()]);
    await s.processSynapseLinks([{
      sourceId: e1._id.toString(),
      targetId: e2._id.toString(),
      reason: "test",
      strength: 0.7,
    }], deltaIds);
    const synapses = await s.getSynapsesBySource(e1._id.toString(), 10);
    expect(synapses[0].targetRawText).toBe("target entry");
    expect(synapses[0].targetSummary).toBe("target summary");
  });
});

// ─── Conscious Processor ──────────────────────────────────────────────────────

describe("findDeltaEntries / findContextEntries / applyTopicAnalysis", () => {
  it("findDeltaEntries returns analyzed entries since date", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "recent entry", makeAnalysis());
    const past = new Date(Date.now() - 60_000);
    const delta = await s.findDeltaEntries("user-1", past);
    expect(delta.map(e => e._id.toString())).toContain(entry._id.toString());
  });

  it("findContextEntries excludes given ids", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "entry 1", makeAnalysis());
    const e2 = await s.createEntry("user-1", "entry 2", makeAnalysis());
    const results = await s.findContextEntries("user-1", [e1._id.toString()]);
    expect(results.map(e => e._id.toString())).not.toContain(e1._id.toString());
    expect(results.map(e => e._id.toString())).toContain(e2._id.toString());
  });

  it("applyTopicAnalysis sets isAnalyzed and increments strength", async () => {
    const s = makeAdapter();
    const entry = await s.createEntry("user-1", "Python code", makeAnalysis({ strength: 3 }));
    await s.applyTopicAnalysis({
      topic: "Python",
      entryIds: [entry._id.toString()],
      importance: 2,
    });
    const updated = await s.getEntryById(entry._id.toString());
    expect(updated?.isAnalyzed).toBe(true);
    expect(updated?.analysis?.strength).toBe(5);
  });
});

// ─── Multi-user isolation ─────────────────────────────────────────────────────

describe("multi-user isolation", () => {
  it("getUniqueUserIds returns all users", async () => {
    const s = makeAdapter();
    await s.createEntry("alice", "alice entry", makeAnalysis());
    await s.createEntry("bob", "bob entry", makeAnalysis());
    const users = await s.getUniqueUserIds();
    expect(users).toContain("alice");
    expect(users).toContain("bob");
  });

  it("findRelevantEntries isolates by user", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "TypeScript rocks", makeAnalysis());
    await s.createEntry("user-2", "TypeScript is great", makeAnalysis());
    const results = await s.findRelevantEntries("user-1", ["TypeScript"]);
    expect(results.every(e => e.userId === "user-1")).toBe(true);
  });

  it("getVaultData isolates by user", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "private", makeAnalysis());
    await s.createEntry("user-2", "also private", makeAnalysis());
    const { entries } = await s.getVaultData("user-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe("user-1");
  });
});

// ─── countEntries ─────────────────────────────────────────────────────────────

describe("countEntries", () => {
  it("returns 0 for empty db", async () => {
    expect(await makeAdapter().countEntries()).toBe(0);
  });

  it("counts across all users", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "entry 1", makeAnalysis());
    await s.createEntry("user-2", "entry 2", makeAnalysis());
    expect(await s.countEntries()).toBe(2);
  });

  it("decreases after pruning", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "alive", makeAnalysis({ strength: 5 }));
    await s.createEntry("user-1", "dead", makeAnalysis({ strength: 0 }));
    expect(await s.countEntries()).toBe(2);
    await s.pruneDeadEntries();
    expect(await s.countEntries()).toBe(1);
  });
});

// ─── Self-referencing synapse ─────────────────────────────────────────────────

describe("processSynapseLinks — self-referencing synapse", () => {
  it("does not create synapse where sourceId === targetId", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "entry", makeAnalysis());
    const id = e._id.toString();
    const deltaIds = new Set([id]);

    const created = await s.processSynapseLinks([{
      sourceId: id,
      targetId: id,
      reason: "self loop",
      strength: 0.9,
    }], deltaIds);

    expect(created).toBe(0);
    const synapses = await s.getSynapsesBySource(id, 10);
    expect(synapses).toHaveLength(0);
  });

  it("skips self-reference but still creates valid synapses in same batch", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "A", makeAnalysis());
    const e2 = await s.createEntry("user-1", "B", makeAnalysis());
    const id1 = e1._id.toString();
    const id2 = e2._id.toString();
    const deltaIds = new Set([id1, id2]);

    const created = await s.processSynapseLinks([
      { sourceId: id1, targetId: id1, reason: "self", strength: 0.9 }, // skipped
      { sourceId: id1, targetId: id2, reason: "valid", strength: 0.8 }, // kept
    ], deltaIds);

    expect(created).toBe(1);
    const synapses = await s.getSynapsesBySource(id1, 10);
    expect(synapses).toHaveLength(1);
    expect(synapses[0].targetId).toBe(id2);
  });
});
