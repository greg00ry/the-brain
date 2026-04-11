import { describe, it, expect, vi } from "vitest";
import {
  getSynapticTree,
  formatSynapticTree,
  getBrainContext,
} from "../services/ai/intent.context.service.js";
import { IStorageAdapter } from "../adapters/IStorageAdapter.js";
import { IEmbeddingAdapter } from "../adapters/IEmbeddingAdapter.js";
import { IVaultEntry } from "../types/brain.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSynapse(targetId: string, overrides = {}) {
  return {
    targetId,
    weight: 0.8,
    reason: "related",
    targetSummary: `Summary of ${targetId}`,
    targetRawText: `Raw text of ${targetId}`,
    ...overrides,
  };
}

function makeEntry(id: string, overrides: Partial<IVaultEntry> = {}): IVaultEntry {
  return {
    _id: { toString: () => id },
    userId: "user-1",
    rawText: `raw text for ${id}`,
    isAnalyzed: true,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    analysis: { summary: `summary of ${id}`, strength: 5, isProcessed: true },
    ...overrides,
  };
}

function makeStorage(overrides: Partial<IStorageAdapter> = {}): IStorageAdapter {
  return {
    getSynapsesBySource: vi.fn().mockResolvedValue([]),
    findSimilarEntries: vi.fn().mockResolvedValue([]),
    findRelevantEntries: vi.fn().mockResolvedValue([]),
    // rest unused
    createEntry: vi.fn(), getEntryById: vi.fn(), getVaultData: vi.fn(),
    deleteVaultEntry: vi.fn(), getUniqueUserIds: vi.fn(),
    getActions: vi.fn(), upsertAction: vi.fn(), removeAction: vi.fn(), getChatHistory: vi.fn(),
    appendChatMessage: vi.fn(), updateEntryEmbedding: vi.fn(),
    findDeltaEntries: vi.fn(), findContextEntries: vi.fn(),
    applyTopicAnalysis: vi.fn(), processSynapseLinks: vi.fn(), markEntriesAnalyzed: vi.fn(),
    findEntriesToDecay: vi.fn(),
    decayEntries: vi.fn(), pruneDeadEntries: vi.fn(), pruneDeadSynapses: vi.fn(),
    countEntries: vi.fn(),
    ...overrides,
  } as unknown as IStorageAdapter;
}

// ═══════════════════════════════════════════════════════════════════════════════
// getSynapticTree
// ═══════════════════════════════════════════════════════════════════════════════

describe("getSynapticTree", () => {
  it("returns empty array when no synapses exist", async () => {
    const storage = makeStorage();
    const result = await getSynapticTree("entry-1", storage);
    expect(result).toHaveLength(0);
  });

  it("returns direct children for depth 1", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1"),
        makeSynapse("child-2"),
      ]),
    });
    const result = await getSynapticTree("root", storage, 1);
    expect(result).toHaveLength(2);
    expect(result[0].entryId).toBe("child-1");
    expect(result[1].entryId).toBe("child-2");
  });

  it("uses targetSummary when available", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { targetSummary: "Custom summary" }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.summary).toBe("Custom summary");
  });

  it("falls back to targetRawText when no summary", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { targetSummary: undefined, targetRawText: "Raw fallback text" }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.summary).toBe("Raw fallback text");
  });

  it("falls back to 'Brak opisu' when neither summary nor raw text", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { targetSummary: undefined, targetRawText: undefined }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.summary).toBe("Brak opisu");
  });

  it("prevents infinite loops via visited set", async () => {
    // A → B → A (cycle)
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "A") return [makeSynapse("B")];
        if (id === "B") return [makeSynapse("A")]; // cycle back
        return [];
      }),
    });
    // should not throw or recurse infinitely
    const result = await getSynapticTree("A", storage, 3);
    expect(result).toBeDefined();
  });

  it("respects depth limit — does not go deeper than SYNAPSE_TREE_DEPTH", async () => {
    // chain: A → B → C → D → E
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        const map: Record<string, string> = { A: "B", B: "C", C: "D", D: "E" };
        return map[id] ? [makeSynapse(map[id])] : [];
      }),
    });
    const result = await getSynapticTree("A", storage, 2);
    // depth 2: A→B (level1), B→C (level2), C→D would be depth 3 — stopped
    const level1 = result;
    const level2 = result[0]?.children ?? [];
    const level3 = level2[0]?.children ?? [];
    expect(level1).toHaveLength(1);
    expect(level2).toHaveLength(1);
    expect(level3).toHaveLength(0);
  });

  it("sets correct level on nodes", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "root") return [makeSynapse("child")];
        if (id === "child") return [makeSynapse("grandchild")];
        return [];
      }),
    });
    const result = await getSynapticTree("root", storage, 3);
    expect(result[0].level).toBe(1);
    expect(result[0].children[0].level).toBe(2);
  });

  it("stores weight and reason on each node", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { weight: 0.95, reason: "strongly related" }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.weight).toBe(0.95);
    expect(node.reason).toBe("strongly related");
  });

  it("returns empty array on storage error", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockRejectedValue(new Error("DB error")),
    });
    const result = await getSynapticTree("root", storage, 1);
    expect(result).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatSynapticTree
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatSynapticTree", () => {
  it("returns empty string for empty nodes", () => {
    expect(formatSynapticTree([])).toBe("");
  });

  it("formats a single node", () => {
    const nodes = [{
      entryId: "e1", summary: "Python tips", weight: 0.9,
      reason: "related", level: 1, children: [],
    }];
    const output = formatSynapticTree(nodes);
    expect(output).toContain("Python tips");
    expect(output).toContain("related");
    expect(output).toContain("9.0/10");
  });

  it("uses └─ for last node and ├─ for non-last", () => {
    const nodes = [
      { entryId: "e1", summary: "A", weight: 0.5, reason: "r", level: 1, children: [] },
      { entryId: "e2", summary: "B", weight: 0.5, reason: "r", level: 1, children: [] },
    ];
    const output = formatSynapticTree(nodes);
    expect(output).toContain("├─");
    expect(output).toContain("└─");
  });

  it("recursively formats children", () => {
    const nodes = [{
      entryId: "root", summary: "Root", weight: 0.8, reason: "top", level: 1,
      children: [{
        entryId: "child", summary: "Child node", weight: 0.6, reason: "sub", level: 2, children: [],
      }],
    }];
    const output = formatSynapticTree(nodes);
    expect(output).toContain("Root");
    expect(output).toContain("Child node");
  });

  it("formats weight as X.X/10 (one decimal)", () => {
    const nodes = [{ entryId: "e1", summary: "s", weight: 0.75, reason: "r", level: 1, children: [] }];
    const output = formatSynapticTree(nodes);
    expect(output).toContain("7.5/10");
  });

  it("includes level number in output", () => {
    const nodes = [{ entryId: "e1", summary: "s", weight: 0.5, reason: "r", level: 3, children: [] }];
    const output = formatSynapticTree(nodes);
    expect(output).toContain("Lvl 3");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getBrainContext
// ═══════════════════════════════════════════════════════════════════════════════

// Multi-query helper: collects all keywords passed across all findRelevantEntries calls
function allQueryKeywords(storage: IStorageAdapter): string[] {
  return (storage.findRelevantEntries as ReturnType<typeof vi.fn>).mock.calls
    .flatMap((call: unknown[]) => call[1] as string[]);
}

describe("getBrainContext", () => {
  // ─── With embedding adapter ────────────────────────────────────────────────

  it("uses embedding adapter when provided", async () => {
    const entries = [makeEntry("e1")];
    const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const embeddingAdapter: IEmbeddingAdapter = { embed };
    const storage = makeStorage({
      findSimilarEntries: vi.fn().mockResolvedValue(entries),
    });

    await getBrainContext("user-1", "python tips", storage, embeddingAdapter);

    // Multi-query: each keyword is embedded separately
    expect(embed).toHaveBeenCalledWith("python");
    expect(embed).toHaveBeenCalledWith("tips");
    expect(storage.findSimilarEntries).toHaveBeenCalled();
    expect(storage.findRelevantEntries).not.toHaveBeenCalled();
  });

  it("returns hasContext true when entries found via embedding", async () => {
    const entries = [makeEntry("e1")];
    const storage = makeStorage({ findSimilarEntries: vi.fn().mockResolvedValue(entries) });
    const embeddingAdapter: IEmbeddingAdapter = { embed: vi.fn().mockResolvedValue([0.1]) };

    const result = await getBrainContext("user-1", "query", storage, embeddingAdapter);
    expect(result.hasContext).toBe(true);
    expect(result.relevantEntries).toHaveLength(1);
  });

  // ─── Without embedding adapter (keyword fallback) ─────────────────────────

  it("uses keyword search when no embedding adapter", async () => {
    const entries = [makeEntry("e1")];
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue(entries) });

    await getBrainContext("user-1", "I prefer Python programming", storage);

    expect(storage.findRelevantEntries).toHaveBeenCalled();
    expect(storage.findSimilarEntries).not.toHaveBeenCalled();
  });

  it("returns hasContext false when no keywords extracted (stop words only)", async () => {
    const storage = makeStorage();

    // Only stop words: "is", "at", "a", "the"
    const result = await getBrainContext("user-1", "is at a the", storage);
    expect(result.hasContext).toBe(false);
    expect(result.relevantEntries).toHaveLength(0);
  });

  it("returns hasContext false when no entries found", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });

    const result = await getBrainContext("user-1", "python programming tips", storage);
    expect(result.hasContext).toBe(false);
  });

  // ─── Synaptic tree ────────────────────────────────────────────────────────

  it("includes synaptic tree in output", async () => {
    const entries = [makeEntry("e1")];
    const storage = makeStorage({
      findRelevantEntries: vi.fn().mockResolvedValue(entries),
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("e2", { targetSummary: "Connected memory" }),
      ]),
    });

    const result = await getBrainContext("user-1", "python tips", storage);
    expect(result.synapticTree).toContain("Connected memory");
  });

  it("synapticTree contains START marker for each entry", async () => {
    const entries = [makeEntry("e1"), makeEntry("e2")];
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue(entries) });

    const result = await getBrainContext("user-1", "python tips", storage);
    const startCount = (result.synapticTree.match(/START:/g) || []).length;
    expect(startCount).toBe(2);
  });

  it("uses entry summary in synaptic tree header", async () => {
    const entry = makeEntry("e1", {
      analysis: { summary: "Python async patterns", tags: [], strength: 5, category: "Tech", isProcessed: true },
    });
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([entry]) });

    const result = await getBrainContext("user-1", "python async", storage);
    expect(result.synapticTree).toContain("Python async patterns");
  });

  it("falls back to rawText substring when no analysis summary", async () => {
    const entry = makeEntry("e1", { analysis: undefined });
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([entry]) });

    const result = await getBrainContext("user-1", "python tips", storage);
    expect(result.synapticTree).toContain("raw text for e1");
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  it("returns error context on storage failure", async () => {
    const storage = makeStorage({
      findRelevantEntries: vi.fn().mockRejectedValue(new Error("DB error")),
    });

    const result = await getBrainContext("user-1", "python tips", storage);
    expect(result.hasContext).toBe(false);
    expect(result.synapticTree).toContain("Błąd");
  });

  it("returns all three fields in result", async () => {
    const storage = makeStorage();
    const result = await getBrainContext("user-1", "query", storage);
    expect(result).toHaveProperty("relevantEntries");
    expect(result).toHaveProperty("synapticTree");
    expect(result).toHaveProperty("hasContext");
  });

  it("shows 'brak połączeń' when entry has no synapses", async () => {
    const entries = [makeEntry("e1")];
    const storage = makeStorage({
      findRelevantEntries: vi.fn().mockResolvedValue(entries),
      getSynapsesBySource: vi.fn().mockResolvedValue([]),
    });
    const result = await getBrainContext("user-1", "python tips", storage);
    expect(result.synapticTree).toContain("brak połączeń");
  });

  it("synapticTree always starts with DRZEWO SYNAPTYCZNE header", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([makeEntry("e1")]) });
    const result = await getBrainContext("user-1", "python", storage);
    expect(result.synapticTree).toContain("DRZEWO SYNAPTYCZNE");
  });

  it("calls getSynapsesBySource once per relevant entry", async () => {
    const entries = [makeEntry("e1"), makeEntry("e2"), makeEntry("e3")];
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue(entries) });
    await getBrainContext("user-1", "python tips", storage);
    expect(storage.getSynapsesBySource).toHaveBeenCalledTimes(3);
  });

  it("passes correct userId to findSimilarEntries", async () => {
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const embeddingAdapter: IEmbeddingAdapter = { embed };
    const storage = makeStorage({ findSimilarEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("specific-user", "query", storage, embeddingAdapter);
    expect(storage.findSimilarEntries).toHaveBeenCalledWith("specific-user", [0.1, 0.2], expect.any(Number));
  });

  it("passes correct userId to findRelevantEntries", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("specific-user", "python programming", storage);
    expect(storage.findRelevantEntries).toHaveBeenCalledWith("specific-user", expect.any(Array));
  });

  it("passes embedding vector to findSimilarEntries", async () => {
    const vector = [0.1, 0.5, 0.9];
    const embeddingAdapter: IEmbeddingAdapter = { embed: vi.fn().mockResolvedValue(vector) };
    const storage = makeStorage({ findSimilarEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "query", storage, embeddingAdapter);
    expect(storage.findSimilarEntries).toHaveBeenCalledWith("user-1", vector, expect.any(Number));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// keyword extraction (tested indirectly via getBrainContext)
// ═══════════════════════════════════════════════════════════════════════════════

describe("keyword extraction (via getBrainContext)", () => {
  it("filters out words with 2 or fewer characters", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    // "is" (2), "at" (2), "ok" (2) — all filtered
    await getBrainContext("user-1", "is at ok", storage);
    const keywords = (storage.findRelevantEntries as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    // should be called with empty array → falls back to hasContext:false via "brak słów kluczowych"
    expect(keywords).toBeUndefined(); // findRelevantEntries not called when no keywords
  });

  it("filters out Polish stop words", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "się dla przy jak", storage);
    // all stop words → findRelevantEntries not called
    expect(storage.findRelevantEntries).not.toHaveBeenCalled();
  });

  it("filters out English stop words", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "the is are was were", storage);
    expect(storage.findRelevantEntries).not.toHaveBeenCalled();
  });

  it("extracts meaningful words from mixed text", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "I like Python programming tips", storage);
    // Multi-query: each keyword queried separately; MULTI_QUERY_MAX_TERMS=3 caps at first 3
    const keywords = allQueryKeywords(storage);
    expect(keywords).toContain("python");
    expect(keywords).toContain("programming");
  });

  it("deduplicates keywords", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "python python python tips tips", storage);
    const keywords = allQueryKeywords(storage);
    const pythonCount = keywords.filter(k => k === "python").length;
    expect(pythonCount).toBe(1);
  });

  it("lowercases all keywords", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "Python TypeScript MongoDB", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).toContain("python");
    expect(keywords).toContain("typescript");
    expect(keywords).toContain("mongodb");
    expect(keywords).not.toContain("Python");
  });

  it("strips punctuation from words", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "python, typescript! mongodb.", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).toContain("python");
    expect(keywords).toContain("typescript");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getSynapticTree — branching and diamond
// ═══════════════════════════════════════════════════════════════════════════════

describe("getSynapticTree — advanced", () => {
  it("returns multiple children at the same level", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "root") return [makeSynapse("A"), makeSynapse("B"), makeSynapse("C")];
        return [];
      }),
    });
    const result = await getSynapticTree("root", storage, 1);
    expect(result).toHaveLength(3);
  });

  it("diamond pattern — shared child appears in both branches but is not traversed twice", async () => {
    // root → A, root → B; both A and B → shared; shared → deep
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "root") return [makeSynapse("A"), makeSynapse("B")];
        if (id === "A") return [makeSynapse("shared")];
        if (id === "B") return [makeSynapse("shared")];
        if (id === "shared") return [makeSynapse("deep")];
        return [];
      }),
    });
    const result = await getSynapticTree("root", storage, 3);
    const allIds = collectIds(result);
    // "shared" can appear in multiple branches (both A and B point to it)
    expect(allIds).toContain("shared");
    // but "deep" (child of shared) is only traversed once — visited set prevents re-traversal
    const deepCount = allIds.filter(id => id === "deep").length;
    expect(deepCount).toBeLessThanOrEqual(1);
  });

  it("returns empty children array for leaf nodes", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "root") return [makeSynapse("leaf")];
        return [];
      }),
    });
    const result = await getSynapticTree("root", storage, 2);
    expect(result[0].children).toHaveLength(0);
  });

  it("default depth (1) returns only direct children", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "root") return [makeSynapse("child")];
        if (id === "child") return [makeSynapse("grandchild")];
        return [];
      }),
    });
    const result = await getSynapticTree("root", storage); // default depth = 1
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases that probe real implementation behaviour
// ═══════════════════════════════════════════════════════════════════════════════

describe("getSynapticTree — reason fallback", () => {
  it("uses 'semantyczne podobieństwo' when reason is empty string", async () => {
    // empty string is falsy → || fallback kicks in
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { reason: "" }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.reason).toBe("semantyczne podobieństwo");
  });

  it("uses 'semantyczne podobieństwo' when reason is undefined", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { reason: undefined }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.reason).toBe("semantyczne podobieństwo");
  });

  it("preserves non-empty reason as-is", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child-1", { reason: "causal link" }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.reason).toBe("causal link");
  });
});

describe("getSynapticTree — SYNAPSE_BRANCH_FACTOR limit", () => {
  it("passes SYNAPSE_BRANCH_FACTOR (5) as limit to getSynapsesBySource", async () => {
    const getSynapsesBySource = vi.fn().mockResolvedValue([]);
    const storage = makeStorage({ getSynapsesBySource });
    await getSynapticTree("root", storage, 1);
    expect(getSynapsesBySource).toHaveBeenCalledWith("root", 5);
  });

  it("does NOT pass a hardcoded limit — uses the constant", async () => {
    const getSynapsesBySource = vi.fn().mockResolvedValue([]);
    const storage = makeStorage({ getSynapsesBySource });
    await getSynapticTree("root", storage, 2);
    // for both root and any children, second arg must be 5 (SYNAPSE_BRANCH_FACTOR)
    for (const call of getSynapsesBySource.mock.calls) {
      expect(call[1]).toBe(5);
    }
  });
});

describe("getSynapticTree — depth=0 stops immediately", () => {
  it("returns empty array when depth is 0", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([makeSynapse("child")]),
    });
    const result = await getSynapticTree("root", storage, 0);
    expect(result).toHaveLength(0);
    expect(storage.getSynapsesBySource).not.toHaveBeenCalled();
  });

  it("returns empty array when depth is negative", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([makeSynapse("child")]),
    });
    const result = await getSynapticTree("root", storage, -5);
    expect(result).toHaveLength(0);
  });
});

describe("getSynapticTree — targetRawText truncation", () => {
  it("truncates targetRawText at RAW_TEXT_PREVIEW_LENGTH (80) chars", async () => {
    const longText = "x".repeat(100);
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child", { targetSummary: undefined, targetRawText: longText }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.summary.length).toBe(80);
    expect(node.summary).toBe("x".repeat(80));
  });

  it("does not truncate targetRawText shorter than 80 chars", async () => {
    const shortText = "short text";
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockResolvedValue([
        makeSynapse("child", { targetSummary: undefined, targetRawText: shortText }),
      ]),
    });
    const [node] = await getSynapticTree("root", storage, 1);
    expect(node.summary).toBe("short text");
  });
});

describe("getBrainContext — rawText truncation", () => {
  it("truncates entry rawText at RAW_TEXT_PREVIEW_LENGTH (80) chars in header", async () => {
    const rawText100 = "a".repeat(100);
    const entry = makeEntry("e1", { analysis: undefined, rawText: rawText100 });
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([entry]) });

    const result = await getBrainContext("user-1", "python tips", storage);
    // truncated to 80, consistent with synapse truncation
    expect(result.synapticTree).toContain(`"${"a".repeat(80)}"`);
    expect(result.synapticTree).not.toContain(`"${"a".repeat(81)}"`);
  });

  it("does not truncate rawText shorter than 80 chars", async () => {
    const shortText = "short raw text";
    const entry = makeEntry("e1", { analysis: undefined, rawText: shortText });
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([entry]) });

    const result = await getBrainContext("user-1", "python tips", storage);
    expect(result.synapticTree).toContain(`"${shortText}"`);
  });
});

describe("getBrainContext — embedding adapter throws", () => {
  it("returns error context when embed() throws", async () => {
    const embeddingAdapter: IEmbeddingAdapter = {
      embed: vi.fn().mockRejectedValue(new Error("embedding service down")),
    };
    const storage = makeStorage();

    const result = await getBrainContext("user-1", "python", storage, embeddingAdapter);
    expect(result.hasContext).toBe(false);
    expect(result.synapticTree).toContain("Błąd");
    expect(result.relevantEntries).toHaveLength(0);
  });

  it("returns error context when findSimilarEntries throws", async () => {
    const embeddingAdapter: IEmbeddingAdapter = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    };
    const storage = makeStorage({
      findSimilarEntries: vi.fn().mockRejectedValue(new Error("vector search failed")),
    });

    const result = await getBrainContext("user-1", "python", storage, embeddingAdapter);
    expect(result.hasContext).toBe(false);
  });

  it("calls embed with the exact userText passed in", async () => {
    const embed = vi.fn().mockResolvedValue([0.1]);
    const embeddingAdapter: IEmbeddingAdapter = { embed };
    const storage = makeStorage({ findSimilarEntries: vi.fn().mockResolvedValue([]) });

    await getBrainContext("user-1", "exact query text", storage, embeddingAdapter);
    // Multi-query: each keyword is embedded separately
    expect(embed).toHaveBeenCalledWith("exact");
    expect(embed).toHaveBeenCalledWith("query");
    expect(embed).toHaveBeenCalledWith("text");
  });
});

describe("getBrainContext — independent visited set per entry", () => {
  it("traverses shared synapse target independently for each entry", async () => {
    // Both e1 and e2 point to "shared-node"
    // Since each getSynapticTree call gets a fresh visited set,
    // "shared-node" appears in BOTH trees
    const e1 = makeEntry("e1");
    const e2 = makeEntry("e2");
    const storage = makeStorage({
      findRelevantEntries: vi.fn().mockResolvedValue([e1, e2]),
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "e1" || id === "e2") return [makeSynapse("shared-node")];
        return [];
      }),
    });

    const result = await getBrainContext("user-1", "python tips", storage);
    // "shared-node" summary appears twice (once per entry tree)
    const count = (result.synapticTree.match(/Summary of shared-node/g) || []).length;
    expect(count).toBe(2);
  });
});

describe("formatSynapticTree — indentation", () => {
  it("uses │  indent for children of non-last nodes", () => {
    // Two siblings [A, B], A has a child A1
    // A is non-last → childIndent = "│  "
    // A1 prefix = "│  └─"
    const nodes = [
      {
        entryId: "A", summary: "Node A", weight: 0.8, reason: "r", level: 1,
        children: [
          { entryId: "A1", summary: "Child A1", weight: 0.5, reason: "r", level: 2, children: [] },
        ],
      },
      { entryId: "B", summary: "Node B", weight: 0.7, reason: "r", level: 1, children: [] },
    ];
    const output = formatSynapticTree(nodes);
    // A is not last → ├─, and its child gets "│  " indent
    expect(output).toContain("├─");        // A's prefix
    expect(output).toContain("│  └─");    // A1's prefix under non-last parent
    expect(output).toContain("└─ [Lvl 1] r → \"Node B\"");  // B is last
  });

  it("uses spaces for children of last nodes (no │)", () => {
    // Only one child → last → childIndent = "   " (spaces, not │)
    const nodes = [
      {
        entryId: "A", summary: "Only child", weight: 0.8, reason: "r", level: 1,
        children: [
          { entryId: "A1", summary: "Grandchild", weight: 0.5, reason: "r", level: 2, children: [] },
        ],
      },
    ];
    const output = formatSynapticTree(nodes);
    expect(output).toContain("└─ [Lvl 1]");   // A is last
    expect(output).toContain("   └─ [Lvl 2]"); // A1 indented with spaces (no │)
    expect(output).not.toContain("│");
  });

  it("weight=0 renders as 0.0/10", () => {
    const nodes = [{ entryId: "e1", summary: "s", weight: 0, reason: "r", level: 1, children: [] }];
    expect(formatSynapticTree(nodes)).toContain("0.0/10");
  });

  it("weight=1.0 renders as 10.0/10", () => {
    const nodes = [{ entryId: "e1", summary: "s", weight: 1.0, reason: "r", level: 1, children: [] }];
    expect(formatSynapticTree(nodes)).toContain("10.0/10");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stop word filter — dead code vs. real filtering
// ═══════════════════════════════════════════════════════════════════════════════

describe("extractKeywords — stop word filter precision", () => {
  // length > 2 check runs BEFORE stop word check
  // words ≤ 2 chars are filtered by LENGTH, not by the stop word list
  // words with length 3+ that are stop words are filtered by the set

  it("'się' (3 chars) is filtered as a stop word", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "programowanie się uczy", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).not.toContain("się");
    expect(keywords).toContain("programowanie");
    expect(keywords).toContain("uczy");
  });

  it("'jest' (4 chars) is filtered as a stop word", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "python jest super", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).not.toContain("jest");
    expect(keywords).toContain("python");
    expect(keywords).toContain("super");
  });

  it("2-char words ('do', 'na', 'on') filtered by length — never reach stop word check", async () => {
    // These are in the stop words list but length <= 2 → filtered before stop word check
    // Result is the same (filtered), but reason is different
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "do na on go", storage);
    // all ≤ 2 chars → no keywords → findRelevantEntries not called
    expect(storage.findRelevantEntries).not.toHaveBeenCalled();
  });

  it("'not' (3 chars) is NOT in stop words — passes through as keyword", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "not working correctly", storage);
    const keywords = (storage.findRelevantEntries as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string[];
    expect(keywords).toContain("not");
  });

  it("Polish diacritics preserved in keywords", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "programowanie języka łatwość", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).toContain("programowanie");
    expect(keywords).toContain("języka");
    expect(keywords).toContain("łatwość");
  });

  it("numbers kept as part of keywords (\\w matches digits)", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "python3 typescript5 version99", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).toContain("python3");
    expect(keywords).toContain("version99");
  });

  it("hyphenated words split at hyphen (hyphen → space → two words)", async () => {
    const storage = makeStorage({ findRelevantEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "self-learning step-by-step", storage);
    const keywords = allQueryKeywords(storage);
    expect(keywords).toContain("self");
    expect(keywords).toContain("learning");
    expect(keywords).toContain("step");
    // "by" = 2 chars → filtered
    expect(keywords).not.toContain("by");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getBrainContext — CONTEXT_TOP_ENTRIES limit
// ═══════════════════════════════════════════════════════════════════════════════

describe("getBrainContext — CONTEXT_TOP_ENTRIES (5) passed to findSimilarEntries", () => {
  it("passes exactly CONTEXT_TOP_ENTRIES (5) as topK to findSimilarEntries", async () => {
    const embeddingAdapter: IEmbeddingAdapter = { embed: vi.fn().mockResolvedValue([0.1]) };
    const storage = makeStorage({ findSimilarEntries: vi.fn().mockResolvedValue([]) });
    await getBrainContext("user-1", "query", storage, embeddingAdapter);
    expect(storage.findSimilarEntries).toHaveBeenCalledWith("user-1", [0.1], 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getBrainContext — SYNAPSE_TREE_DEPTH passed to getSynapticTree
// ═══════════════════════════════════════════════════════════════════════════════

describe("getBrainContext — getSynapticTree called with SYNAPSE_TREE_DEPTH (5)", () => {
  it("getSynapsesBySource is called at depth up to 5 levels", async () => {
    // If SYNAPSE_TREE_DEPTH=5 is passed correctly, getSynapsesBySource traverses 5 levels deep
    // chain: e1→child1→grand1→great1→level4→level5 but level5's children require depth>0
    const e1 = makeEntry("e1");
    const storage = makeStorage({
      findRelevantEntries: vi.fn().mockResolvedValue([e1]),
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "e1")     return [makeSynapse("child1")];
        if (id === "child1") return [makeSynapse("grand1")];
        if (id === "grand1") return [makeSynapse("great1")];
        if (id === "great1") return [makeSynapse("level4")];
        if (id === "level4") return [makeSynapse("level5")];
        return [];
      }),
    });

    const result = await getBrainContext("user-1", "python programming", storage);
    const allCalls = (storage.getSynapsesBySource as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(allCalls).toContain("e1");
    expect(allCalls).toContain("child1");
    expect(allCalls).toContain("grand1");
    expect(allCalls).toContain("great1");
    expect(allCalls).toContain("level4");
    // level5 is NOT traversed (depth reaches 0)
    expect(allCalls).not.toContain("level5");
    expect(result.hasContext).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getSynapticTree — self-referencing synapse
// ═══════════════════════════════════════════════════════════════════════════════

describe("getSynapticTree — self-referencing synapse", () => {
  it("A → A: creates node with no children (visited prevents traversal)", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "A") return [makeSynapse("A", { targetSummary: "Self reference" })];
        return [];
      }),
    });

    const result = await getSynapticTree("A", storage, 3);
    // The self-referencing node IS in the result (it's a valid target synapse)
    expect(result).toHaveLength(1);
    expect(result[0].entryId).toBe("A");
    // But it has no children (visited prevents going back into A)
    expect(result[0].children).toHaveLength(0);
  });

  it("self-referencing node shows targetSummary (not skipped entirely)", async () => {
    const storage = makeStorage({
      getSynapsesBySource: vi.fn().mockImplementation(async (id: string) => {
        if (id === "root") return [makeSynapse("root", { targetSummary: "I point to myself" })];
        return [];
      }),
    });

    const result = await getSynapticTree("root", storage, 2);
    expect(result[0].summary).toBe("I point to myself");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getBrainContext — empty string text
// ═══════════════════════════════════════════════════════════════════════════════

describe("getBrainContext — empty and whitespace text", () => {
  it("empty string with keyword path → Brak słów kluczowych", async () => {
    const storage = makeStorage();
    const result = await getBrainContext("user-1", "", storage);
    expect(result.hasContext).toBe(false);
    expect(result.synapticTree).toContain("Brak słów kluczowych");
    expect(storage.findRelevantEntries).not.toHaveBeenCalled();
  });

  it("whitespace-only text → Brak słów kluczowych", async () => {
    const storage = makeStorage();
    const result = await getBrainContext("user-1", "   \t  \n  ", storage);
    expect(result.hasContext).toBe(false);
    expect(result.synapticTree).toContain("Brak słów kluczowych");
  });

  it("empty string with embedding adapter → embed('') called (no guard)", async () => {
    const embed = vi.fn().mockResolvedValue([0.0, 0.0]);
    const embeddingAdapter: IEmbeddingAdapter = { embed };
    const storage = makeStorage({ findSimilarEntries: vi.fn().mockResolvedValue([]) });

    await getBrainContext("user-1", "", storage, embeddingAdapter);
    // no guard — embed("") is called as-is
    expect(embed).toHaveBeenCalledWith("");
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function collectIds(nodes: { entryId: string; children: typeof nodes }[]): string[] {
  return nodes.flatMap(n => [n.entryId, ...collectIds(n.children)]);
}
