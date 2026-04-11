import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSubconsciousRoutine } from "../services/brain/subconscious.routine.js";
import { IStorageAdapter } from "../adapters/IStorageAdapter.js";
import { IVaultEntry } from "../types/brain.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;

function makeEntry(overrides: Partial<IVaultEntry> = {}): IVaultEntry {
  const id = `entry-${++idCounter}`;
  return {
    _id: { toString: () => id },
    userId: "user-1",
    rawText: "test entry",
    isAnalyzed: true,
    isPermanent: false,
    lastActivityAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    createdAt: new Date(),
    updatedAt: new Date(),
    analysis: { summary: "test", strength: 5, isProcessed: true },
    ...overrides,
  };
}

function makeStorage(overrides: Partial<IStorageAdapter> = {}): IStorageAdapter {
  return {
    findEntriesToDecay: vi.fn().mockResolvedValue([]),
    decayEntries: vi.fn().mockResolvedValue(0),
    pruneDeadEntries: vi.fn().mockResolvedValue(0),
    pruneDeadSynapses: vi.fn().mockResolvedValue(0),
    countEntries: vi.fn().mockResolvedValue(0),
    // unused but required by interface
    createEntry: vi.fn(),
    getEntryById: vi.fn(),
    getVaultData: vi.fn(),
    deleteVaultEntry: vi.fn(),
    getUniqueUserIds: vi.fn(),
    getActions: vi.fn(),
    upsertAction: vi.fn(),
    removeAction: vi.fn(),
    getChatHistory: vi.fn(),
    appendChatMessage: vi.fn(),
    getUserProfile: vi.fn(),
    upsertUserProfile: vi.fn(),
    findRelevantEntries: vi.fn(),
    findSimilarEntries: vi.fn(),
    updateEntryEmbedding: vi.fn(),
    findDeltaEntries: vi.fn(),
    findContextEntries: vi.fn(),
    applyTopicAnalysis: vi.fn(), markEntriesAnalyzed: vi.fn(),
    getSynapsesBySource: vi.fn(),
    processSynapseLinks: vi.fn(),
    ...overrides,
  } as unknown as IStorageAdapter;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runSubconsciousRoutine", () => {
  beforeEach(() => { idCounter = 0; });

  // ─── Empty storage ──────────────────────────────────────────────────────

  it("returns zero stats when storage is empty", async () => {
    const storage = makeStorage();
    const stats = await runSubconsciousRoutine(storage);
    expect(stats.decayed).toBe(0);
    expect(stats.pruned).toBe(0);
    expect(stats.totalProcessed).toBe(0);
  });

  // ─── Phase 1: Decay ─────────────────────────────────────────────────────

  it("decays entries that are inactive", async () => {
    const entries = [makeEntry(), makeEntry()];
    const storage = makeStorage({
      findEntriesToDecay: vi.fn().mockResolvedValue(entries),
      decayEntries: vi.fn().mockResolvedValue(2),
    });
    const stats = await runSubconsciousRoutine(storage);
    expect(storage.decayEntries).toHaveBeenCalledOnce();
    expect(stats.decayed).toBe(2);
  });

  it("does not call decayEntries when no entries to decay", async () => {
    const storage = makeStorage({
      findEntriesToDecay: vi.fn().mockResolvedValue([]),
    });
    await runSubconsciousRoutine(storage);
    expect(storage.decayEntries).not.toHaveBeenCalled();
  });

  it("passes correct ids to decayEntries (multiple entries)", async () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const storage = makeStorage({
      findEntriesToDecay: vi.fn().mockResolvedValue(entries),
      decayEntries: vi.fn().mockResolvedValue(3),
    });
    await runSubconsciousRoutine(storage);
    const calledWith = (storage.decayEntries as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith).toHaveLength(3);
  });

  // ─── Phase 2: Pruning ────────────────────────────────────────────────────

  it("prunes dead entries and synapses", async () => {
    const storage = makeStorage({
      pruneDeadEntries: vi.fn().mockResolvedValue(5),
      pruneDeadSynapses: vi.fn().mockResolvedValue(3),
    });
    const stats = await runSubconsciousRoutine(storage);
    expect(stats.pruned).toBe(8); // 5 entries + 3 synapses
  });

  it("always calls pruneDeadEntries and pruneDeadSynapses", async () => {
    const storage = makeStorage();
    await runSubconsciousRoutine(storage);
    expect(storage.pruneDeadEntries).toHaveBeenCalledOnce();
    expect(storage.pruneDeadSynapses).toHaveBeenCalledOnce();
  });

  it("stats.pruned is sum of pruned entries and synapses", async () => {
    const storage = makeStorage({
      pruneDeadEntries: vi.fn().mockResolvedValue(10),
      pruneDeadSynapses: vi.fn().mockResolvedValue(7),
    });
    const stats = await runSubconsciousRoutine(storage);
    expect(stats.pruned).toBe(17);
  });

  it("stats.pruned is 0 when nothing to prune", async () => {
    const storage = makeStorage({
      pruneDeadEntries: vi.fn().mockResolvedValue(0),
      pruneDeadSynapses: vi.fn().mockResolvedValue(0),
    });
    const stats = await runSubconsciousRoutine(storage);
    expect(stats.pruned).toBe(0);
  });

  // ─── totalProcessed ──────────────────────────────────────────────────────

  it("reports total entries count", async () => {
    const storage = makeStorage({
      countEntries: vi.fn().mockResolvedValue(42),
    });
    const stats = await runSubconsciousRoutine(storage);
    expect(stats.totalProcessed).toBe(42);
  });

  // ─── Phase order ─────────────────────────────────────────────────────────

  it("calls phases in correct order: findToDecay → prune", async () => {
    const callOrder: string[] = [];
    const storage = makeStorage({
      findEntriesToDecay: vi.fn().mockImplementation(async () => { callOrder.push("findToDecay"); return []; }),
      pruneDeadEntries: vi.fn().mockImplementation(async () => { callOrder.push("pruneEntries"); return 0; }),
      pruneDeadSynapses: vi.fn().mockImplementation(async () => { callOrder.push("pruneSynapses"); return 0; }),
    });
    await runSubconsciousRoutine(storage);
    expect(callOrder[0]).toBe("findToDecay");
    expect(callOrder.indexOf("pruneEntries")).toBeGreaterThan(callOrder.indexOf("findToDecay"));
  });

  // ─── Error handling ──────────────────────────────────────────────────────

  it("returns partial stats when storage throws on decay", async () => {
    const storage = makeStorage({
      findEntriesToDecay: vi.fn().mockRejectedValue(new Error("DB down")),
    });
    const stats = await runSubconsciousRoutine(storage);
    // should not throw, returns default stats
    expect(stats).toBeDefined();
    expect(stats.decayed).toBe(0);
  });

  it("returns partial stats when pruneDeadEntries throws", async () => {
    const storage = makeStorage({
      pruneDeadEntries: vi.fn().mockRejectedValue(new Error("IO error")),
    });
    const stats = await runSubconsciousRoutine(storage);
    expect(stats).toBeDefined();
  });
});
