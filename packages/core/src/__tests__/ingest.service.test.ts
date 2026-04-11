import { describe, it, expect, vi } from "vitest";
import { proccessAndStore } from "../services/ingest/ingest.service.js";
import { analyzeTextWithAI } from "../services/ai/analyze.service.js";
import { ILLMAdapter } from "../adapters/ILLMAdapter.js";
import { IStorageAdapter } from "../adapters/IStorageAdapter.js";
import { IEmbeddingAdapter } from "../adapters/IEmbeddingAdapter.js";
import { IVaultEntry } from "../types/brain.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLLM(response: string | null): ILLMAdapter {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function makeLLMError(): ILLMAdapter {
  return { complete: vi.fn().mockRejectedValue(new Error("LLM timeout")) };
}

function llmAnalysis(overrides = {}) {
  return JSON.stringify({
    summary: "Test summary",
    strength: 7,
    ...overrides,
  });
}

function makeEntry(id = "entry-1"): IVaultEntry {
  return {
    _id: { toString: () => id },
    userId: "user-1",
    rawText: "test",
    isAnalyzed: true,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    analysis: { summary: "s", strength: 5, isProcessed: true },
  };
}

function makeStorage(entry = makeEntry()): IStorageAdapter {
  return {
    createEntry: vi.fn().mockResolvedValue(entry),
    updateEntryEmbedding: vi.fn().mockResolvedValue(undefined),
    // unused
    getEntryById: vi.fn(), getVaultData: vi.fn(), deleteVaultEntry: vi.fn(),
    getUniqueUserIds: vi.fn(), getActions: vi.fn(),
    upsertAction: vi.fn(), getChatHistory: vi.fn(), appendChatMessage: vi.fn(),
    findRelevantEntries: vi.fn(), findSimilarEntries: vi.fn(),
    findDeltaEntries: vi.fn(), findContextEntries: vi.fn(),
    applyTopicAnalysis: vi.fn(), processSynapseLinks: vi.fn(), markEntriesAnalyzed: vi.fn(),
    findEntriesToDecay: vi.fn(),
    decayEntries: vi.fn(), pruneDeadEntries: vi.fn(), pruneDeadSynapses: vi.fn(),
    countEntries: vi.fn(),
    getSynapsesBySource: vi.fn(),
  } as unknown as IStorageAdapter;
}

// ═══════════════════════════════════════════════════════════════════════════════
// analyzeTextWithAI
// ═══════════════════════════════════════════════════════════════════════════════

describe("analyzeTextWithAI", () => {

  // ─── Happy path ────────────────────────────────────────────────────────────

  it("parses valid LLM JSON response", async () => {
    const llm = makeLLM(llmAnalysis());
    const result = await analyzeTextWithAI("python tips", llm);
    expect(result.summary).toBe("Test summary");
    expect(result.strength).toBe(7);
    expect(result.isProcessed).toBe(true);
  });

  it("sets isProcessed=true on successful parse", async () => {
    const result = await analyzeTextWithAI("text", makeLLM(llmAnalysis()));
    expect(result.isProcessed).toBe(true);
  });

  // ─── Fallback: null response ───────────────────────────────────────────────

  it("returns FALLBACK when LLM returns null", async () => {
    const result = await analyzeTextWithAI("hello world", makeLLM(null));
    expect(result.isProcessed).toBe(false);
    expect(result.strength).toBe(5);
  });

  it("FALLBACK summary is full text when shorter than 100 chars", async () => {
    const result = await analyzeTextWithAI("short", makeLLM(null));
    expect(result.summary).toBe("short");
  });

  it("FALLBACK truncates text at 100 chars and appends '...'", async () => {
    const text = "x".repeat(150);
    const result = await analyzeTextWithAI(text, makeLLM(null));
    expect(result.summary).toBe("x".repeat(100) + "...");
    expect(result.summary.length).toBe(103);
  });

  it("FALLBACK summary does NOT append '...' to exact 100-char text", async () => {
    const text = "x".repeat(100);
    const result = await analyzeTextWithAI(text, makeLLM(null));
    expect(result.summary).toBe("x".repeat(100));
    expect(result.summary.endsWith("...")).toBe(false);
  });

  // ─── Fallback: invalid JSON ────────────────────────────────────────────────

  it("returns FALLBACK when LLM returns invalid JSON", async () => {
    const result = await analyzeTextWithAI("text", makeLLM("not json"));
    expect(result.isProcessed).toBe(false);
  });

  it("returns FALLBACK when LLM returns empty string", async () => {
    // empty string → cleanAndParseJSON returns null → FALLBACK
    const result = await analyzeTextWithAI("text", makeLLM(""));
    expect(result.isProcessed).toBe(false);
  });

  // ─── LLM throws ───────────────────────────────────────────────────────────

  it("returns FALLBACK when LLM throws — consistent with embedding non-fatal behaviour", async () => {
    const result = await analyzeTextWithAI("text", makeLLMError());
    expect(result.isProcessed).toBe(false);
  });

  // ─── Missing fields in LLM response ──────────────────────────────────────

  it("missing summary falls back to truncate(text) — same 100-char limit as FALLBACK", async () => {
    const text = "x".repeat(150);
    const llm = makeLLM(JSON.stringify({ strength: 5 }));
    const result = await analyzeTextWithAI(text, llm);
    expect(result.summary).toBe("x".repeat(100) + "...");
    expect(result.isProcessed).toBe(true);
  });

  it("missing strength defaults to 0", async () => {
    const llm = makeLLM(JSON.stringify({ summary: "s" }));
    const result = await analyzeTextWithAI("text", llm);
    expect(result.strength).toBe(0);
  });

  it("strength as string '8' is coerced to number 8", async () => {
    const llm = makeLLM(JSON.stringify({ summary: "s", strength: "8" }));
    const result = await analyzeTextWithAI("text", llm);
    expect(result.strength).toBe(8);
  });

  it("strength as non-numeric string defaults to 0", async () => {
    const llm = makeLLM(JSON.stringify({ summary: "s", strength: "high" }));
    const result = await analyzeTextWithAI("text", llm);
    expect(result.strength).toBe(0);
  });

  it("strength=0 from LLM is returned as 0 (not overridden)", async () => {
    const llm = makeLLM(JSON.stringify({ summary: "s", strength: 0 }));
    const result = await analyzeTextWithAI("text", llm);
    expect(result.strength).toBe(0);
  });

  it("calls LLM with correct temperature and maxTokens", async () => {
    const llm = makeLLM(llmAnalysis());
    await analyzeTextWithAI("text", llm);
    const call = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.temperature).toBe(0.7);
    expect(call.maxTokens).toBe(500);
  });

  it("LLM prompt contains the input text", async () => {
    const llm = makeLLM(llmAnalysis());
    await analyzeTextWithAI("unique input xyz", llm);
    const call = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.userPrompt).toContain("unique input xyz");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// proccessAndStore
// ═══════════════════════════════════════════════════════════════════════════════

describe("proccessAndStore", () => {
  const TEXT = "I learned that Python is fast";
  const USER = "user-42";

  // ─── Happy path ────────────────────────────────────────────────────────────

  it("returns the created entry", async () => {
    const entry = makeEntry("new-id");
    const storage = makeStorage(entry);
    const result = await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage);
    expect(result._id.toString()).toBe("new-id");
  });

  it("calls createEntry with correct userId and text", async () => {
    const storage = makeStorage();
    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage);
    expect(storage.createEntry).toHaveBeenCalledWith(USER, TEXT, expect.any(Object));
  });

  it("passes analysis result from LLM to createEntry", async () => {
    const storage = makeStorage();
    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis({ summary: "custom summary" })), storage);
    const analysis = (storage.createEntry as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(analysis.summary).toBe("custom summary");
    expect(analysis.isProcessed).toBe(true);
  });

  // ─── Without embedding ────────────────────────────────────────────────────

  it("does not call updateEntryEmbedding when no embedding adapter", async () => {
    const storage = makeStorage();
    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage);
    expect(storage.updateEntryEmbedding).not.toHaveBeenCalled();
  });

  // ─── With embedding ───────────────────────────────────────────────────────

  it("calls embed with original text", async () => {
    const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const embeddingAdapter: IEmbeddingAdapter = { embed };
    const storage = makeStorage();

    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage, embeddingAdapter);
    expect(embed).toHaveBeenCalledWith(TEXT);
  });

  it("calls updateEntryEmbedding with entry._id.toString() and vector", async () => {
    const vector = [0.1, 0.5, 0.9];
    const entry = makeEntry("specific-id");
    const storage = makeStorage(entry);
    const embeddingAdapter: IEmbeddingAdapter = { embed: vi.fn().mockResolvedValue(vector) };

    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage, embeddingAdapter);
    expect(storage.updateEntryEmbedding).toHaveBeenCalledWith("specific-id", vector);
  });

  it("embedding is called after createEntry (needs entry._id)", async () => {
    const callOrder: string[] = [];
    const storage = makeStorage();
    (storage.createEntry as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("createEntry");
      return makeEntry();
    });
    const embeddingAdapter: IEmbeddingAdapter = {
      embed: vi.fn().mockImplementation(async () => {
        callOrder.push("embed");
        return [0.1];
      }),
    };

    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage, embeddingAdapter);
    expect(callOrder.indexOf("createEntry")).toBeLessThan(callOrder.indexOf("embed"));
  });

  // ─── Embedding error is non-fatal ─────────────────────────────────────────

  it("returns entry even when embed() throws", async () => {
    const entry = makeEntry("safe-id");
    const storage = makeStorage(entry);
    const embeddingAdapter: IEmbeddingAdapter = {
      embed: vi.fn().mockRejectedValue(new Error("GPU out of memory")),
    };

    const result = await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage, embeddingAdapter);
    expect(result._id.toString()).toBe("safe-id");
  });

  it("does not call updateEntryEmbedding when embed() throws", async () => {
    const storage = makeStorage();
    const embeddingAdapter: IEmbeddingAdapter = {
      embed: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage, embeddingAdapter);
    expect(storage.updateEntryEmbedding).not.toHaveBeenCalled();
  });

  it("returns entry even when updateEntryEmbedding() throws", async () => {
    const entry = makeEntry("safe-id");
    const storage = makeStorage(entry);
    (storage.updateEntryEmbedding as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("write failed"));
    const embeddingAdapter: IEmbeddingAdapter = { embed: vi.fn().mockResolvedValue([0.1]) };

    const result = await proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage, embeddingAdapter);
    expect(result._id.toString()).toBe("safe-id");
  });

  // ─── LLM / storage errors propagate ──────────────────────────────────────

  it("LLM error uses FALLBACK analysis — createEntry still called", async () => {
    const storage = makeStorage();
    await proccessAndStore(USER, TEXT, makeLLMError(), storage);
    expect(storage.createEntry).toHaveBeenCalled();
    const analysis = (storage.createEntry as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(analysis.isProcessed).toBe(false);
  });

  it("propagates createEntry error", async () => {
    const storage = makeStorage();
    (storage.createEntry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB full"));
    await expect(
      proccessAndStore(USER, TEXT, makeLLM(llmAnalysis()), storage)
    ).rejects.toThrow("DB full");
  });

  // ─── FALLBACK analysis is still stored ───────────────────────────────────

  it("stores FALLBACK analysis when LLM returns null", async () => {
    const storage = makeStorage();
    await proccessAndStore(USER, TEXT, makeLLM(null), storage);
    const analysis = (storage.createEntry as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(analysis.isProcessed).toBe(false);
  });
});
