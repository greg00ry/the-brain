import { describe, it, expect, vi, beforeEach } from "vitest";
import { runConsciousProcessor } from "../services/brain/conscious.processor.js";
import { IStorageAdapter } from "../adapters/IStorageAdapter.js";
import { ILLMAdapter } from "../adapters/ILLMAdapter.js";
import { IVaultEntry } from "../types/brain.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;

function makeEntry(overrides: Partial<IVaultEntry> = {}): IVaultEntry {
  const id = `entry-${++idCounter}`;
  return {
    _id: { toString: () => id },
    userId: "user-1",
    rawText: "test entry about Python",
    isAnalyzed: true,
    isConsolidated: false,
    isPermanent: false,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    analysis: { summary: "Python test", strength: 5, isProcessed: true },
    ...overrides,
  };
}

function makeAnalysisResponse(topics: object[], synapses: object[] = []) {
  return JSON.stringify({ topics, synapses });
}

function makeLTMResponse() {
  return JSON.stringify({ summary: "Consolidated memory" });
}

function makeLLM(response: string | null = null): ILLMAdapter {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function makeLLMError(): ILLMAdapter {
  return { complete: vi.fn().mockRejectedValue(new Error("LLM timeout")) };
}

function makeStorage(overrides: Partial<IStorageAdapter> = {}): IStorageAdapter {
  return {
    getUniqueUserIds: vi.fn().mockResolvedValue(["user-1"]),
    findDeltaEntries: vi.fn().mockResolvedValue([]),
    findContextEntries: vi.fn().mockResolvedValue([]),
    applyTopicAnalysis: vi.fn().mockResolvedValue(1),
    processSynapseLinks: vi.fn().mockResolvedValue(0),
    findStrongEntries: vi.fn().mockResolvedValue([]),
    upsertLTM: vi.fn().mockResolvedValue(undefined),
    markConsolidated: vi.fn().mockResolvedValue(undefined),
    // unused but required by interface
    createEntry: vi.fn(),
    getEntryById: vi.fn(),
    getVaultData: vi.fn(),
    deleteVaultEntry: vi.fn(),
    getActions: vi.fn(),
    upsertAction: vi.fn(),
    removeAction: vi.fn(),
    getChatHistory: vi.fn(),
    appendChatMessage: vi.fn(),
    findRelevantEntries: vi.fn(),
    findSimilarEntries: vi.fn(),
    updateEntryEmbedding: vi.fn(),
    getUserProfile: vi.fn(),
    upsertUserProfile: vi.fn(),
    getConsolidatedEntryIds: vi.fn(),
    findEntriesToDecay: vi.fn(),
    decayEntries: vi.fn(),
    pruneDeadEntries: vi.fn(),
    pruneDeadSynapses: vi.fn(),
    findEntriesReadyForLTM: vi.fn(),
    countEntries: vi.fn(),
    getSynapsesBySource: vi.fn(),
    ...overrides,
  } as unknown as IStorageAdapter;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runConsciousProcessor", () => {
  beforeEach(() => { idCounter = 0; });

  // ─── No users ────────────────────────────────────────────────────────────

  it("returns zero stats when no users exist", async () => {
    const llm = makeLLM();
    const storage = makeStorage({ getUniqueUserIds: vi.fn().mockResolvedValue([]) });
    const stats = await runConsciousProcessor(llm, storage);
    expect(stats.analyzed).toBe(0);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  // ─── No delta entries ────────────────────────────────────────────────────

  it("skips LLM analysis when no delta entries", async () => {
    const llm = makeLLM();
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue([]) });
    await runConsciousProcessor(llm, storage);
    expect(storage.applyTopicAnalysis).not.toHaveBeenCalled();
  });

  // ─── Step 1: Delta analysis ──────────────────────────────────────────────

  it("calls LLM with delta entries for analysis", async () => {
    const entries = [makeEntry(), makeEntry()];
    const llm = makeLLM(makeAnalysisResponse([]));
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue(entries) });
    await runConsciousProcessor(llm, storage);
    expect(llm.complete).toHaveBeenCalled();
  });

  it("applies topic analysis for each topic returned by LLM", async () => {
    const entries = [makeEntry()];
    const topics = [
      { topic: "Python", entryIds: [entries[0]._id.toString()], importance: 8 },
      { topic: "Testing", entryIds: [entries[0]._id.toString()], importance: 5 },
    ];
    const llm = makeLLM(makeAnalysisResponse(topics));
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue(entries) });
    await runConsciousProcessor(llm, storage);
    expect(storage.applyTopicAnalysis).toHaveBeenCalledTimes(2);
  });

  it("stats.analyzed sums up counts from applyTopicAnalysis", async () => {
    const entries = [makeEntry()];
    const topics = [
      { topic: "T1", entryIds: [], importance: 5 },
      { topic: "T2", entryIds: [], importance: 5 },
    ];
    const llm = makeLLM(makeAnalysisResponse(topics));
    const storage = makeStorage({
      findDeltaEntries: vi.fn().mockResolvedValue(entries),
      applyTopicAnalysis: vi.fn().mockResolvedValue(3),
    });
    const stats = await runConsciousProcessor(llm, storage);
    expect(stats.analyzed).toBe(6); // 2 topics × 3
  });

  it("processes synapses returned by LLM", async () => {
    const e1 = makeEntry();
    const e2 = makeEntry();
    const synapses = [{ sourceId: e1._id.toString(), targetId: e2._id.toString(), reason: "related", strength: 0.8 }];
    const llm = makeLLM(makeAnalysisResponse([], synapses));
    const storage = makeStorage({
      findDeltaEntries: vi.fn().mockResolvedValue([e1]),
      processSynapseLinks: vi.fn().mockResolvedValue(1),
    });
    const stats = await runConsciousProcessor(llm, storage);
    expect(storage.processSynapseLinks).toHaveBeenCalledOnce();
    expect(stats.synapsesCreated).toBe(1);
  });

  it("does not call processSynapseLinks when no synapses returned", async () => {
    const storage = makeStorage({
      findDeltaEntries: vi.fn().mockResolvedValue([makeEntry()]),
    });
    const llm = makeLLM(makeAnalysisResponse([], []));
    await runConsciousProcessor(llm, storage);
    expect(storage.processSynapseLinks).not.toHaveBeenCalled();
  });

  // ─── Batching ────────────────────────────────────────────────────────────

  it("processes delta entries in batches of BATCH_SIZE (5)", async () => {
    const entries = Array.from({ length: 11 }, () => makeEntry());
    const llm = makeLLM(makeAnalysisResponse([]));
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue(entries) });
    await runConsciousProcessor(llm, storage);
    // 11 entries → 3 batches (5+5+1) → LLM called 3 times
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it("fetches context entries for each batch", async () => {
    const entries = Array.from({ length: 6 }, () => makeEntry());
    const llm = makeLLM(makeAnalysisResponse([]));
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue(entries) });
    await runConsciousProcessor(llm, storage);
    // 6 entries → 2 batches
    expect(storage.findContextEntries).toHaveBeenCalledTimes(2);
  });

  // ─── LLM null / error handling ───────────────────────────────────────────

  it("skips analysis when LLM returns null", async () => {
    const llm = makeLLM(null);
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue([makeEntry()]) });
    const stats = await runConsciousProcessor(llm, storage);
    expect(stats.analyzed).toBe(0);
    expect(storage.applyTopicAnalysis).not.toHaveBeenCalled();
  });

  it("skips analysis when LLM throws", async () => {
    const llm = makeLLMError();
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue([makeEntry()]) });
    const stats = await runConsciousProcessor(llm, storage);
    expect(stats.analyzed).toBe(0);
  });

  it("skips analysis when LLM returns invalid JSON", async () => {
    const llm = makeLLM("not json at all");
    const storage = makeStorage({ findDeltaEntries: vi.fn().mockResolvedValue([makeEntry()]) });
    const stats = await runConsciousProcessor(llm, storage);
    expect(stats.analyzed).toBe(0);
  });

  it("continues to consolidation even if analysis batch fails", async () => {
    const llm: ILLMAdapter = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error("analysis failed"))
        .mockResolvedValueOnce(makeLTMResponse()),
    };
    const strongEntry = makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } });
    const storage = makeStorage({
      findDeltaEntries: vi.fn().mockResolvedValue([makeEntry()]),
      findStrongEntries: vi.fn().mockResolvedValue([strongEntry]),
    });
    const stats = await runConsciousProcessor(llm, storage);
    expect(stats.consolidated).toBe(1);
  });

  // ─── Step 2: LTM consolidation ───────────────────────────────────────────

  it("consolidates strong entries into LTM with topic 'general'", async () => {
    const strong = [
      makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } }),
      makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } }),
    ];
    const llm = makeLLM(makeLTMResponse());
    const storage = makeStorage({ findStrongEntries: vi.fn().mockResolvedValue(strong) });
    const stats = await runConsciousProcessor(llm, storage);
    expect(storage.upsertLTM).toHaveBeenCalledOnce();
    const [, topicArg] = (storage.upsertLTM as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(topicArg).toBe("general");
    expect(stats.consolidated).toBe(2);
  });

  it("all strong entries are consolidated in one LTM call", async () => {
    const strong = [
      makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } }),
      makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } }),
    ];
    const llm = makeLLM(makeLTMResponse());
    const storage = makeStorage({ findStrongEntries: vi.fn().mockResolvedValue(strong) });
    await runConsciousProcessor(llm, storage);
    expect(storage.upsertLTM).toHaveBeenCalledTimes(1);
  });

  it("calls markConsolidated after successful LTM creation", async () => {
    const strong = [makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } })];
    const llm = makeLLM(makeLTMResponse());
    const storage = makeStorage({ findStrongEntries: vi.fn().mockResolvedValue(strong) });
    await runConsciousProcessor(llm, storage);
    expect(storage.markConsolidated).toHaveBeenCalledOnce();
  });

  it("does not call markConsolidated when LTM creation fails (null response)", async () => {
    const strong = [makeEntry({ analysis: { summary: "s", strength: 10, isProcessed: true } })];
    const llm = makeLLM(null);
    const storage = makeStorage({ findStrongEntries: vi.fn().mockResolvedValue(strong) });
    await runConsciousProcessor(llm, storage);
    expect(storage.markConsolidated).not.toHaveBeenCalled();
  });

  // ─── Multiple users ──────────────────────────────────────────────────────

  it("processes each user independently", async () => {
    const storage = makeStorage({
      getUniqueUserIds: vi.fn().mockResolvedValue(["user-1", "user-2", "user-3"]),
      findDeltaEntries: vi.fn().mockResolvedValue([]),
      findStrongEntries: vi.fn().mockResolvedValue([]),
    });
    const llm = makeLLM(makeAnalysisResponse([]));
    await runConsciousProcessor(llm, storage);
    expect(storage.findDeltaEntries).toHaveBeenCalledTimes(3);
    expect(storage.findStrongEntries).toHaveBeenCalledTimes(3);
  });

  it("passes correct userId to findDeltaEntries and findStrongEntries", async () => {
    const storage = makeStorage({
      getUniqueUserIds: vi.fn().mockResolvedValue(["alice", "bob"]),
      findDeltaEntries: vi.fn().mockResolvedValue([]),
      findStrongEntries: vi.fn().mockResolvedValue([]),
    });
    await runConsciousProcessor(makeLLM(), storage);
    const deltaUserIds = (storage.findDeltaEntries as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(deltaUserIds).toContain("alice");
    expect(deltaUserIds).toContain("bob");
  });

  // ─── Return stats ────────────────────────────────────────────────────────

  it("returns correct stats structure", async () => {
    const storage = makeStorage();
    const stats = await runConsciousProcessor(makeLLM(), storage);
    expect(stats).toHaveProperty("analyzed");
    expect(stats).toHaveProperty("consolidated");
    expect(stats).toHaveProperty("synapsesCreated");
  });

  it("returns zero stats on top-level error", async () => {
    const storage = makeStorage({
      getUniqueUserIds: vi.fn().mockRejectedValue(new Error("DB crashed")),
    });
    const stats = await runConsciousProcessor(makeLLM(), storage);
    expect(stats.analyzed).toBe(0);
    expect(stats.consolidated).toBe(0);
    expect(stats.synapsesCreated).toBe(0);
  });
});
