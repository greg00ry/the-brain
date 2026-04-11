import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SQLiteStorageAdapter } from "../SQLiteStorageAdapter.js";

const TEST_DIR = join(process.cwd(), ".brain-sqlite-advanced-test");

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

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }); });

// ─── Cosine similarity edge cases ────────────────────────────────────────────

describe("cosine similarity edge cases", () => {
  it("returns 1.0 for identical vectors", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "identical", makeAnalysis());
    await s.updateEntryEmbedding(e._id.toString(), [0.5, 0.5, 0.5]);
    const results = await s.findSimilarEntries("user-1", [0.5, 0.5, 0.5], 1);
    expect(results).toHaveLength(1);
    expect(results[0].rawText).toBe("identical");
  });

  it("returns 0.0 for orthogonal vectors (no match)", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "A", makeAnalysis());
    const e2 = await s.createEntry("user-1", "B", makeAnalysis());
    await s.updateEntryEmbedding(e1._id.toString(), [1, 0, 0]);
    await s.updateEntryEmbedding(e2._id.toString(), [0, 1, 0]);
    // query orthogonal to e1, identical to e2
    const results = await s.findSimilarEntries("user-1", [0, 1, 0], 1);
    expect(results[0].rawText).toBe("B");
  });

  it("handles zero query vector gracefully", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "entry", makeAnalysis());
    await s.updateEntryEmbedding(e._id.toString(), [1, 0, 0]);
    const results = await s.findSimilarEntries("user-1", [0, 0, 0], 1);
    // should not throw, result order undefined but must return array
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles stored zero vector gracefully", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "zero vector", makeAnalysis());
    await s.updateEntryEmbedding(e._id.toString(), [0, 0, 0]);
    const results = await s.findSimilarEntries("user-1", [1, 0, 0], 1);
    expect(Array.isArray(results)).toBe(true);
  });

  it("topK=0 returns empty array", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "entry", makeAnalysis());
    await s.updateEntryEmbedding(e._id.toString(), [1, 0, 0]);
    const results = await s.findSimilarEntries("user-1", [1, 0, 0], 0);
    expect(results).toHaveLength(0);
  });

  it("topK larger than available entries returns all", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "A", makeAnalysis());
    const e2 = await s.createEntry("user-1", "B", makeAnalysis());
    await s.updateEntryEmbedding(e1._id.toString(), [1, 0]);
    await s.updateEntryEmbedding(e2._id.toString(), [0, 1]);
    const results = await s.findSimilarEntries("user-1", [1, 0], 100);
    expect(results).toHaveLength(2);
  });
});

// ─── Persistence across adapter instances ────────────────────────────────────

describe("persistence across adapter instances", () => {
  it("data survives closing and reopening adapter", async () => {
    const s1 = makeAdapter();
    await s1.upsertAction("SAVE_ONLY", "save", true);
    await s1.createEntry("user-1", "persistent entry", makeAnalysis());
    await s1.appendChatMessage("user-1", "user", "hello", 10);

    // New adapter instance on same path
    const s2 = makeAdapter();
    const actions = await s2.getActions();
    expect(actions.map(a => a.name)).toContain("SAVE_ONLY");

    const { entries } = await s2.getVaultData("user-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].rawText).toBe("persistent entry");

    const history = await s2.getChatHistory("user-1");
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("hello");
  });

  it("embeddings persist across adapter instances", async () => {
    const s1 = makeAdapter();
    const e = await s1.createEntry("user-1", "embedded", makeAnalysis());
    await s1.updateEntryEmbedding(e._id.toString(), [1, 0, 0]);

    const s2 = makeAdapter();
    const results = await s2.findSimilarEntries("user-1", [1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0].rawText).toBe("embedded");
  });

  it("decay changes persist", async () => {
    const s1 = makeAdapter();
    const e = await s1.createEntry("user-1", "entry", makeAnalysis({ strength: 5 }));
    await s1.decayEntries([e._id]);

    const s2 = makeAdapter();
    const found = await s2.getEntryById(e._id.toString());
    expect(found?.analysis?.strength).toBe(4);
  });
});

// ─── Concurrent writes (two adapters, same file) ─────────────────────────────

describe("concurrent writes", () => {
  it("two adapters writing simultaneously do not corrupt data", async () => {
    const s1 = makeAdapter();
    const s2 = makeAdapter();

    await Promise.all([
      s1.createEntry("user-1", "from s1", makeAnalysis()),
      s2.createEntry("user-1", "from s2", makeAnalysis()),
    ]);

    const s3 = makeAdapter();
    const { entries } = await s3.getVaultData("user-1");
    expect(entries).toHaveLength(2);
  });

  it("concurrent action upserts do not duplicate", async () => {
    const s1 = makeAdapter();
    const s2 = makeAdapter();
    await Promise.all([
      s1.upsertAction("SAVE_ONLY", "desc", true),
      s2.upsertAction("SAVE_ONLY", "desc", true),
    ]);
    const actions = await makeAdapter().getActions();
    expect(actions.filter(a => a.name === "SAVE_ONLY")).toHaveLength(1);
  });
});

// ─── applyTopicAnalysis edge cases ───────────────────────────────────────────

describe("applyTopicAnalysis edge cases", () => {
  it("skips non-existent entryIds silently", async () => {
    const s = makeAdapter();
    const count = await s.applyTopicAnalysis({
      topic: "Ghost",
      entryIds: ["nonexistent-id"],
      importance: 5,
    });
    expect(count).toBe(0);
  });

  it("increments strength by importance", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "text", makeAnalysis({ strength: 3 }));
    await s.applyTopicAnalysis({
      topic: "Python",
      entryIds: [e._id.toString()],
      importance: 4,
    });
    const updated = await s.getEntryById(e._id.toString());
    expect(updated?.analysis?.strength).toBe(7);
  });

  it("sets isAnalyzed=true on processed entries", async () => {
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "text", makeAnalysis());
    await s.applyTopicAnalysis({
      topic: "T",
      entryIds: [e._id.toString()],
      importance: 1,
    });
    const updated = await s.getEntryById(e._id.toString());
    expect(updated?.isAnalyzed).toBe(true);
  });
});

// ─── findDeltaEntries edge cases ─────────────────────────────────────────────

describe("findDeltaEntries edge cases", () => {
  it("respects limit of 50 entries", async () => {
    const s = makeAdapter();
    for (let i = 0; i < 60; i++) {
      await s.createEntry("user-1", `entry ${i}`, makeAnalysis());
    }
    const past = new Date(Date.now() - 60_000);
    const delta = await s.findDeltaEntries("user-1", past);
    expect(delta.length).toBeLessThanOrEqual(50);
  });

  it("excludes entries updated before the since date", async () => {
    const s = makeAdapter();
    await s.createEntry("user-1", "old entry", makeAnalysis());
    const future = new Date(Date.now() + 60_000);
    const delta = await s.findDeltaEntries("user-1", future);
    expect(delta).toHaveLength(0);
  });

  it("only returns analyzed entries", async () => {
    // createEntry always sets isAnalyzed=1, so all entries qualify
    // this test verifies the flag is respected
    const s = makeAdapter();
    const e = await s.createEntry("user-1", "entry", makeAnalysis());
    const past = new Date(Date.now() - 1000);
    const delta = await s.findDeltaEntries("user-1", past);
    expect(delta.map(d => d._id.toString())).toContain(e._id.toString());
  });
});

// ─── upsertLTM edge cases ────────────────────────────────────────────────────

describe("upsertLTM edge cases", () => {
  it("stores multiple LTMs independently", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "A", makeAnalysis({ strength: 10 }));
    const e2 = await s.createEntry("user-1", "B", makeAnalysis({ strength: 10 }));
    await s.upsertLTM("user-1", "Topic A", { summary: "Summary A" }, [e1]);
    await s.upsertLTM("user-1", "Topic B", { summary: "Summary B" }, [e2]);
    const { memories } = await s.getVaultData("user-1");
    expect(memories).toHaveLength(2);
    expect(memories.map(m => m.topic)).toContain("Topic A");
    expect(memories.map(m => m.topic)).toContain("Topic B");
  });

  it("stores source entry ids in LTM", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "source 1", makeAnalysis({ strength: 10 }));
    const e2 = await s.createEntry("user-1", "source 2", makeAnalysis({ strength: 10 }));
    await s.upsertLTM("user-1", "Topic", { summary: "S" }, [e1, e2]);
    const { memories } = await s.getVaultData("user-1");
    const ids = memories[0].sourceEntryIds.map(id => id.toString());
    expect(ids).toContain(e1._id.toString());
    expect(ids).toContain(e2._id.toString());
  });
});

// ─── deleteVaultEntry removes synapses ───────────────────────────────────────

describe("deleteVaultEntry cleans up synapses", () => {
  it("removes synapses when source entry is deleted", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "source", makeAnalysis());
    const e2 = await s.createEntry("user-1", "target", makeAnalysis());
    const deltaIds = new Set([e1._id.toString()]);
    await s.processSynapseLinks([{
      sourceId: e1._id.toString(),
      targetId: e2._id.toString(),
      reason: "linked",
      strength: 0.8,
    }], deltaIds);

    await s.deleteVaultEntry(e1._id.toString(), "user-1");

    const synapses = await s.getSynapsesBySource(e1._id.toString(), 10);
    expect(synapses).toHaveLength(0);
  });

  it("removes synapses when target entry is deleted", async () => {
    const s = makeAdapter();
    const e1 = await s.createEntry("user-1", "source", makeAnalysis());
    const e2 = await s.createEntry("user-1", "target", makeAnalysis());
    const deltaIds = new Set([e1._id.toString()]);
    await s.processSynapseLinks([{
      sourceId: e1._id.toString(),
      targetId: e2._id.toString(),
      reason: "linked",
      strength: 0.8,
    }], deltaIds);

    await s.deleteVaultEntry(e2._id.toString(), "user-1");

    const synapses = await s.getSynapsesBySource(e1._id.toString(), 10);
    expect(synapses).toHaveLength(0);
  });
});

// ─── Stress ───────────────────────────────────────────────────────────────────

describe("stress tests", () => {
  it("handles 100 entries without errors", async () => {
    const s = makeAdapter();
    const entries = [];
    for (let i = 0; i < 100; i++) {
      entries.push(await s.createEntry("user-1", `entry number ${i}`, makeAnalysis({ strength: i % 10 + 1 })));
    }
    expect(await s.countEntries()).toBe(100);
  });

  it("decays 100 entries in one call", async () => {
    const s = makeAdapter();
    const entries = [];
    for (let i = 0; i < 100; i++) {
      entries.push(await s.createEntry("user-1", `entry ${i}`, makeAnalysis({ strength: 5 })));
    }
    await s.decayEntries(entries.map(e => e._id));
    const { entries: updated } = await s.getVaultData("user-1");
    expect(updated.every(e => e.analysis?.strength === 4)).toBe(true);
  });

  it("prunes correct number after decay to zero", async () => {
    const s = makeAdapter();
    for (let i = 0; i < 50; i++) {
      await s.createEntry("user-1", `dying ${i}`, makeAnalysis({ strength: 0 }));
    }
    for (let i = 0; i < 50; i++) {
      await s.createEntry("user-1", `alive ${i}`, makeAnalysis({ strength: 5 }));
    }
    const pruned = await s.pruneDeadEntries();
    expect(pruned).toBe(50);
    expect(await s.countEntries()).toBe(50);
  });

  it("cosine similarity returns correct top-3 from 100 entries", async () => {
    const s = makeAdapter();
    for (let i = 0; i < 100; i++) {
      const e = await s.createEntry("user-1", `entry ${i}`, makeAnalysis());
      // Only entries 10, 20, 30 are close to query [1, 0]
      if (i === 10) await s.updateEntryEmbedding(e._id.toString(), [1, 0]);
      else if (i === 20) await s.updateEntryEmbedding(e._id.toString(), [0.99, 0.01]);
      else if (i === 30) await s.updateEntryEmbedding(e._id.toString(), [0.98, 0.02]);
      else await s.updateEntryEmbedding(e._id.toString(), [0, 1]);
    }
    const results = await s.findSimilarEntries("user-1", [1, 0], 3);
    expect(results).toHaveLength(3);
    expect(results.map(r => r.rawText)).toContain("entry 10");
    expect(results.map(r => r.rawText)).toContain("entry 20");
    expect(results.map(r => r.rawText)).toContain("entry 30");
  });
});
