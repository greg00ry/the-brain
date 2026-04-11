import { describe, it, expect, vi, beforeEach } from "vitest";
import { Brain } from "../Brain.js";
import { SavingPlugin } from "../plugins/SavingPlugin.js";
import { MemoryPlugin } from "../plugins/MemoryPlugin.js";
import type { ILLMAdapter, LLMRequest } from "../adapters/ILLMAdapter.js";
import type { IStorageAdapter } from "../adapters/IStorageAdapter.js";

// ─── Minimal mock storage ────────────────────────────────────────────────────

function makeMockStorage(): IStorageAdapter {
  return {
    createEntry: vi.fn().mockResolvedValue({ _id: "entry-1", rawText: "test", strength: 5 }),
    getEntryById: vi.fn().mockResolvedValue(null),
    getVaultData: vi.fn().mockResolvedValue({ entries: [], memories: [] }),
    deleteVaultEntry: vi.fn().mockResolvedValue(null),
    getUniqueUserIds: vi.fn().mockResolvedValue([]),
    getActions: vi.fn().mockResolvedValue([
      { name: "RESEARCH_BRAIN", description: "user asks about memory" },
      { name: "SAVE_ONLY", description: "user wants to save" },
    ]),
    upsertAction: vi.fn().mockResolvedValue(undefined),
    getChatHistory: vi.fn().mockResolvedValue([]),
    appendChatMessage: vi.fn().mockResolvedValue(undefined),
    getUserProfile: vi.fn().mockResolvedValue(null),
    upsertUserProfile: vi.fn().mockResolvedValue(undefined),
    findRelevantEntries: vi.fn().mockResolvedValue([]),
    findSimilarEntries: vi.fn().mockResolvedValue([]),
    updateEntryEmbedding: vi.fn().mockResolvedValue(undefined),
    findDeltaEntries: vi.fn().mockResolvedValue([]),
    findContextEntries: vi.fn().mockResolvedValue([]),
    applyTopicAnalysis: vi.fn().mockResolvedValue(0),
    markEntriesAnalyzed: vi.fn().mockResolvedValue(undefined),
    getSynapsesBySource: vi.fn().mockResolvedValue([]),
    processSynapseLinks: vi.fn().mockResolvedValue(0),
    findEntriesToDecay: vi.fn().mockResolvedValue([]),
    decayEntries: vi.fn().mockResolvedValue(0),
    pruneDeadEntries: vi.fn().mockResolvedValue(0),
    pruneDeadSynapses: vi.fn().mockResolvedValue(0),
    countEntries: vi.fn().mockResolvedValue(0),
    removeAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as IStorageAdapter;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Brain", () => {
  let llm: ILLMAdapter;
  let storage: IStorageAdapter;
  let brain: Brain;

  beforeEach(async () => {
    llm = {
      complete: vi.fn().mockImplementation((req: LLMRequest) => {
        // Intent classification — prompt contains "### ROLE"
        if (req.userPrompt?.includes("### ROLE")) {
          return Promise.resolve('{"action":"SAVE_ONLY","confidence":90,"reasoning":"user is sharing info"}');
        }
        // Analyze text — prompt contains "Analyze the following text"
        if (req.userPrompt?.includes("Analyze the following text")) {
          return Promise.resolve('{"summary":"test note","strength":5}');
        }
        // Personality response (SAVE_ONLY handler)
        return Promise.resolve("Ciekawe! Opowiedz mi więcej.");
      }),
    };
    storage = makeMockStorage();
    brain = new Brain(llm, storage);
    await brain.use(new SavingPlugin(), new MemoryPlugin());
  });

  it("loadActions loads actions from storage", async () => {
    await brain.loadActions();
    expect(storage.getActions).toHaveBeenCalled();
  });

  it("process SAVE_ONLY returns answer and entryId", async () => {
    const result = await brain.process("user-1", "Mam spotkanie jutro o 10");
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.answer).toBeTruthy();
    expect(result.entryId).toBeDefined();
  });

  it("process SAVE_ONLY appends chat history", async () => {
    await brain.process("user-1", "Mam spotkanie jutro o 10");
    expect(storage.appendChatMessage).toHaveBeenCalledWith("user-1", "user", expect.any(String), expect.any(Number));
    expect(storage.appendChatMessage).toHaveBeenCalledWith("user-1", "assistant", expect.any(String), expect.any(Number));
  });

  it("process RESEARCH_BRAIN calls llm for answer", async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((req: LLMRequest) => {
      if (req.userPrompt?.includes("AVAILABLE ACTIONS")) {
        return Promise.resolve('{"action":"RESEARCH_BRAIN","confidence":92,"reasoning":"memory query"}');
      }
      return Promise.resolve("Nie mam jeszcze nic na ten temat.");
    });

    const result = await brain.process("user-1", "co wiem o Pythonie");
    expect(result.action).toBe("RESEARCH_BRAIN");
    expect(result.answer).toBeTruthy();
  });

  it("registerAction adds custom handler", async () => {
    const handler = vi.fn().mockResolvedValue("custom response");

    (storage.getActions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "RESEARCH_BRAIN", description: "user asks about memory" },
      { name: "SAVE_ONLY", description: "user wants to save" },
      { name: "CUSTOM_ACTION", description: "does something custom" },
    ]);

    await brain.registerAction("CUSTOM_ACTION", "does something custom", handler);

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '{"action":"CUSTOM_ACTION","confidence":90,"reasoning":"matched"}'
    );

    const result = await brain.process("user-1", "do the custom thing");
    expect(result.action).toBe("CUSTOM_ACTION");
    expect(handler).toHaveBeenCalled();
  });

  // ─── Unknown action ────────────────────────────────────────────────────────

  it("process returns error message for unknown action without handler", async () => {
    // LLM returns an action name that exists in cache but has no handler
    (storage.getActions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "SAVE_ONLY", description: "save" },
      { name: "GHOST_ACTION", description: "ghost" },
    ]);
    await brain.loadActions();

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '{"action":"GHOST_ACTION","confidence":90,"reasoning":"ghost"}'
    );

    const result = await brain.process("user-1", "something");
    expect(result.action).toBe("GHOST_ACTION");
    expect(result.answer).toContain("GHOST_ACTION");
    expect(result.entryId).toBeUndefined();
  });

  // ─── SAVE_ONLY fallback answer ─────────────────────────────────────────────

  it("SAVE_ONLY returns fallback answer when LLM returns null", async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((req: LLMRequest) => {
      if (req.userPrompt?.includes("### ROLE")) return Promise.resolve('{"action":"SAVE_ONLY","confidence":90,"reasoning":"save"}');
      if (req.userPrompt?.includes("Analyze the following text")) return Promise.resolve('{"summary":"s","strength":5}');
      return Promise.resolve(null); // SAVE_ONLY handler gets null
    });
    const result = await brain.process("user-1", "some fact");
    expect(result.answer).toBe("Zapisałem to.");
  });

  // ─── RESEARCH_BRAIN fallback answer ───────────────────────────────────────

  it("RESEARCH_BRAIN returns fallback answer when LLM returns null", async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((req: LLMRequest) => {
      if (req.userPrompt?.includes("### ROLE")) return Promise.resolve('{"action":"RESEARCH_BRAIN","confidence":92,"reasoning":"recall"}');
      return Promise.resolve(null);
    });
    const result = await brain.process("user-1", "co wiem o pythonie?");
    expect(result.answer).toBe("Coś poszło nie tak z generowaniem odpowiedzi.");
  });

  // ─── RESEARCH_BRAIN without context ──────────────────────────────────────

  it("RESEARCH_BRAIN without context uses fallback prompt", async () => {
    (storage.findRelevantEntries as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((req: LLMRequest) => {
      if (req.userPrompt?.includes("### ROLE")) return Promise.resolve('{"action":"RESEARCH_BRAIN","confidence":92,"reasoning":"recall"}');
      return Promise.resolve("I don't know yet");
    });
    const result = await brain.process("user-1", "co wiem o kwantach?");
    expect(result.answer).toBe("I don't know yet");
    const calls = (llm.complete as ReturnType<typeof vi.fn>).mock.calls;
    const researchCall = calls.find(c => c[0].userPrompt?.includes("don't have anything stored"));
    expect(researchCall).toBeDefined();
  });

  // ─── RESEARCH_BRAIN appends chat history ─────────────────────────────────

  it("RESEARCH_BRAIN also appends chat history", async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((req: LLMRequest) => {
      if (req.userPrompt?.includes("### ROLE")) return Promise.resolve('{"action":"RESEARCH_BRAIN","confidence":92,"reasoning":"recall"}');
      return Promise.resolve("odpowiedź");
    });
    await brain.process("user-1", "co wiem?");
    expect(storage.appendChatMessage).toHaveBeenCalledWith("user-1", "user", expect.any(String), expect.any(Number));
    expect(storage.appendChatMessage).toHaveBeenCalledWith("user-1", "assistant", expect.any(String), expect.any(Number));
  });

  // ─── registerAction ────────────────────────────────────────────────────────

  it("registerAction calls upsertAction with isBuiltIn=false", async () => {
    (storage.getActions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await brain.registerAction("MY_ACTION", "desc", vi.fn().mockResolvedValue("ok"));
    expect(storage.upsertAction).toHaveBeenCalledWith("MY_ACTION", "desc", false);
  });

  it("registerAction refreshes actionsCache from storage", async () => {
    const updatedActions = [
      { name: "SAVE_ONLY", description: "save" },
      { name: "MY_ACTION", description: "desc" },
    ];
    (storage.getActions as ReturnType<typeof vi.fn>).mockResolvedValue(updatedActions);
    await brain.registerAction("MY_ACTION", "desc", vi.fn().mockResolvedValue("ok"));
    expect(storage.getActions).toHaveBeenCalled();
  });

  it("custom handler receives userId, text, context, llm, chatHistory", async () => {
    const handler = vi.fn().mockResolvedValue("handled");
    (storage.getActions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "SAVE_ONLY", description: "save" },
      { name: "MY_ACTION", description: "my" },
    ]);
    (storage.getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "user", content: "prev message" },
    ]);
    await brain.registerAction("MY_ACTION", "my", handler);

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '{"action":"MY_ACTION","confidence":90,"reasoning":"matched"}'
    );

    await brain.process("user-42", "trigger it");
    expect(handler).toHaveBeenCalledWith(
      "user-42",
      "trigger it",
      expect.objectContaining({ synapticTree: expect.any(String), hasContext: expect.any(Boolean) }),
      expect.any(Object), // llm
      expect.arrayContaining([expect.objectContaining({ role: "user" })]),
    );
  });

  // ─── recall() and save() ──────────────────────────────────────────────────

  it("recall() delegates to getBrainContext and returns context", async () => {
    (storage.findRelevantEntries as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await brain.recall("user-1", "python tips");
    expect(result).toHaveProperty("hasContext");
    expect(result).toHaveProperty("synapticTree");
    expect(result).toHaveProperty("relevantEntries");
  });

  it("save() delegates to proccessAndStore and returns entry", async () => {
    const result = await brain.save("user-1", "some fact to save");
    expect(result).toBeDefined();
    expect(storage.createEntry).toHaveBeenCalledWith("user-1", "some fact to save", expect.any(Object));
  });

  // ─── runMaintenance() ─────────────────────────────────────────────────────

  it("runMaintenance returns subStats and consciousStats", async () => {
    const result = await brain.runMaintenance();
    expect(result).toHaveProperty("subStats");
    expect(result).toHaveProperty("consciousStats");
    expect(result.subStats).toHaveProperty("decayed");
    expect(result.consciousStats).toHaveProperty("analyzed");
  });

  it("runMaintenance calls subconscious and conscious processors", async () => {
    await brain.runMaintenance();
    expect(storage.pruneDeadEntries).toHaveBeenCalled();
    expect(storage.getUniqueUserIds).toHaveBeenCalled();
  });

  // ─── synapseMode config ───────────────────────────────────────────────────

  it("uses LLM for synapses by default (no embedding adapter passed to processor)", async () => {
    const embeddingAdapter = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) };
    storage = makeMockStorage();
    // synapseMode defaults to "llm" — embedding adapter should NOT be passed to conscious processor
    const brainWithEmbedding = new Brain(llm, storage, embeddingAdapter);
    await brainWithEmbedding.use(new SavingPlugin(), new MemoryPlugin());
    await brainWithEmbedding.runMaintenance();
    // LLM mode: findSimilarEntries not called (no delta entries anyway, but embed should not be called)
    expect(embeddingAdapter.embed).not.toHaveBeenCalled();
  });

  it("uses embeddings for synapses when synapseMode is 'embedding'", async () => {
    const embeddingAdapter = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) };
    const mockStorage = makeMockStorage();
    (mockStorage.getUniqueUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(["user-1"]);
    (mockStorage.findDeltaEntries as ReturnType<typeof vi.fn>).mockResolvedValue([{
      _id: { toString: () => "entry-1" },
      userId: "user-1",
      rawText: "some fact",
      isAnalyzed: false,
      isPermanent: false,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    const brainWithEmbedding = new Brain(llm, mockStorage, embeddingAdapter, {
      memory: { synapseMode: "embedding" },
    });
    await brainWithEmbedding.use(new SavingPlugin(), new MemoryPlugin());
    await brainWithEmbedding.runMaintenance();
    expect(embeddingAdapter.embed).toHaveBeenCalled();
    expect(mockStorage.findSimilarEntries).toHaveBeenCalled();
    expect(mockStorage.markEntriesAnalyzed).toHaveBeenCalled();
  });

  it("synapseMode 'embedding' without embedding adapter falls back to LLM silently", async () => {
    const brainNoEmbedding = new Brain(llm, storage, undefined, {
      memory: { synapseMode: "embedding" },
    });
    await brainNoEmbedding.use(new SavingPlugin(), new MemoryPlugin());
    // Should not throw — just runs LLM mode
    await expect(brainNoEmbedding.runMaintenance()).resolves.toBeDefined();
  });

  // ─── Maintenance triggered every MAINTENANCE_EVERY_N saves ───────────────

  it("maintenance is triggered after every 20th SAVE_ONLY (fire and forget)", async () => {
    const maintenanceSpy = vi.spyOn(brain, "runMaintenance").mockResolvedValue({
      subStats: { decayed: 0, pruned: 0, totalProcessed: 0 },
      consciousStats: { analyzed: 0, synapsesCreated: 0 },
    });

    for (let i = 0; i < 20; i++) {
      await brain.process("user-1", `fact number ${i}`);
      await Promise.resolve();
    }

    expect(maintenanceSpy).toHaveBeenCalledTimes(1);
  });

  it("maintenance not triggered before 20th save", async () => {
    const maintenanceSpy = vi.spyOn(brain, "runMaintenance").mockResolvedValue({
      subStats: { decayed: 0, pruned: 0, totalProcessed: 0 },
      consciousStats: { analyzed: 0, synapsesCreated: 0 },
    });

    for (let i = 0; i < 19; i++) {
      await brain.process("user-1", `fact number ${i}`);
    }

    expect(maintenanceSpy).not.toHaveBeenCalled();
  });

  // ─── process() with empty actionsCache ───────────────────────────────────

  it("process falls back to SAVE_ONLY when actionsCache is empty", async () => {
    const freshBrain = new Brain(llm, storage);
    // no use() called — actionsCache empty → classifyIntent returns default fallback
    const result = await freshBrain.process("user-1", "save this fact");
    // handler not registered so answer is error message, but action should be SAVE_ONLY (default fallback)
    expect(result.action).toBe("SAVE_ONLY");
  });

  it("process passes chat history from storage to classifyIntent", async () => {
    const history = [
      { role: "user" as const, content: "earlier message" },
      { role: "assistant" as const, content: "earlier reply" },
    ];
    (storage.getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(history);

    await brain.process("user-1", "follow up");

    const intentCall = (llm.complete as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0].userPrompt?.includes("### ROLE"));
    expect(intentCall).toBeDefined();
    expect(intentCall![0].userPrompt).toContain("earlier message");
  });
});
