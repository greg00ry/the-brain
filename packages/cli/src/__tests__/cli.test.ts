import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mock instances (created before vi.mock factories run) ─────────────

const { mockBrain, mockConnectDB, mockDisconnect } = vi.hoisted(() => {
  const mockBrain = {
    loadActions: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockResolvedValue({ action: "SAVE_ONLY", answer: "Got it!" }),
    save: vi.fn().mockResolvedValue({ _id: "entry-123" }),
    recall: vi.fn().mockResolvedValue({ synapticTree: "memory tree", hasContext: true }),
    runMaintenance: vi.fn().mockResolvedValue({
      subStats: { decayed: 2, pruned: 1, totalProcessed: 0 },
      consciousStats: { synapsesCreated: 4 },
    }),
  };
  return {
    mockBrain,
    mockConnectDB: vi.fn().mockResolvedValue(undefined),
    mockDisconnect: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@the-brain/core", () => ({
  // Regular functions (not arrow) so they work as constructors with `new`.
  // Returning a non-null object from a constructor makes `new Ctor()` return that object.
  Brain: function() { return mockBrain; },
  OpenAICompatibleAdapter: function() {},
  OpenAICompatibleEmbeddingAdapter: function() {},
}));

vi.mock("@the-brain/adapter-mongo", () => ({
  MongoStorageAdapter: function() {},
  connectDB: mockConnectDB,
}));

vi.mock("mongoose", () => ({
  default: { disconnect: mockDisconnect },
}));

vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const originalArgv = process.argv.slice();
let consoleSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

// Load CLI fresh with given subcommand args, drain async handlers.
// Commander does not await async action() callbacks — if they reject the error
// becomes an unhandledRejection. We suppress it here so vitest doesn't fail the suite.
async function runCLI(...args: string[]) {
  process.argv = ["node", "brain", ...args];
  vi.resetModules();

  const swallow = (_reason: unknown) => {};
  process.on("unhandledRejection", swallow);

  await import("../index.js");
  // Drain the microtask queue so async commander action() handlers complete
  await new Promise<void>((resolve) => setImmediate(resolve));

  process.off("unhandledRejection", swallow);
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // restore default mock return values after clearAllMocks
  mockBrain.loadActions.mockResolvedValue(undefined);
  mockBrain.process.mockResolvedValue({ action: "SAVE_ONLY", answer: "Got it!" });
  mockBrain.save.mockResolvedValue({ _id: "entry-123" });
  mockBrain.recall.mockResolvedValue({ synapticTree: "memory tree", hasContext: true });
  mockBrain.runMaintenance.mockResolvedValue({
    subStats: { decayed: 2, pruned: 1, totalProcessed: 0 },
    consciousStats: { synapsesCreated: 4 },
  });
  mockConnectDB.mockResolvedValue(undefined);
  mockDisconnect.mockResolvedValue(undefined);
});

afterEach(() => {
  process.argv = originalArgv.slice();
  consoleSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// process command
// ═══════════════════════════════════════════════════════════════════════════════

describe("process command", () => {
  it("calls brain.process with the text argument", async () => {
    await runCLI("process", "save this fact");
    expect(mockBrain.process).toHaveBeenCalledWith(
      expect.any(String),
      "save this fact",
    );
  });

  it("prints [ACTION] answer to console", async () => {
    mockBrain.process.mockResolvedValue({ action: "RESEARCH_BRAIN", answer: "Here is what I know." });
    await runCLI("process", "what do I know?");
    expect(consoleSpy).toHaveBeenCalledWith("[RESEARCH_BRAIN] Here is what I know.");
  });

  it("calls connectDB and loadActions during setup", async () => {
    await runCLI("process", "test");
    expect(mockConnectDB).toHaveBeenCalledTimes(1);
    expect(mockBrain.loadActions).toHaveBeenCalledTimes(1);
  });

  it("calls mongoose.disconnect during teardown", async () => {
    await runCLI("process", "test");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("calls teardown even when brain.process throws", async () => {
    mockBrain.process.mockRejectedValue(new Error("LLM down"));
    await runCLI("process", "test");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// save command
// ═══════════════════════════════════════════════════════════════════════════════

describe("save command", () => {
  it("calls brain.save with the text argument", async () => {
    await runCLI("save", "important note");
    expect(mockBrain.save).toHaveBeenCalledWith(
      expect.any(String),
      "important note",
      false,
    );
  });

  it("calls brain.save with isPermanent=true when --permanent flag is set", async () => {
    await runCLI("save", "important note", "--permanent");
    expect(mockBrain.save).toHaveBeenCalledWith(
      expect.any(String),
      "important note",
      true,
    );
  });

  it("prints Saved [id] [PERMANENT] when --permanent flag is set", async () => {
    mockBrain.save.mockResolvedValue({ _id: "perm-123" });
    await runCLI("save", "some text", "--permanent");
    expect(consoleSpy).toHaveBeenCalledWith("Saved [perm-123] [PERMANENT]");
  });

  it("prints Saved [id] to console", async () => {
    mockBrain.save.mockResolvedValue({ _id: "abc-456" });
    await runCLI("save", "some text");
    expect(consoleSpy).toHaveBeenCalledWith("Saved [abc-456]");
  });

  it("calls connectDB and loadActions during setup", async () => {
    await runCLI("save", "test");
    expect(mockConnectDB).toHaveBeenCalledTimes(1);
    expect(mockBrain.loadActions).toHaveBeenCalledTimes(1);
  });

  it("calls mongoose.disconnect during teardown", async () => {
    await runCLI("save", "test");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("calls teardown even when brain.save throws", async () => {
    mockBrain.save.mockRejectedValue(new Error("DB error"));
    await runCLI("save", "test");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// recall command
// ═══════════════════════════════════════════════════════════════════════════════

describe("recall command", () => {
  it("calls brain.recall with the text argument", async () => {
    await runCLI("recall", "python tips");
    expect(mockBrain.recall).toHaveBeenCalledWith(
      expect.any(String),
      "python tips",
    );
  });

  it("prints synapticTree when hasContext is true", async () => {
    mockBrain.recall.mockResolvedValue({ synapticTree: "deep memory tree", hasContext: true });
    await runCLI("recall", "something");
    expect(consoleSpy).toHaveBeenCalledWith("deep memory tree");
  });

  it("prints 'No relevant memories found.' when hasContext is false", async () => {
    mockBrain.recall.mockResolvedValue({ synapticTree: "", hasContext: false });
    await runCLI("recall", "something obscure");
    expect(consoleSpy).toHaveBeenCalledWith("No relevant memories found.");
  });

  it("calls connectDB and loadActions during setup", async () => {
    await runCLI("recall", "test");
    expect(mockConnectDB).toHaveBeenCalledTimes(1);
    expect(mockBrain.loadActions).toHaveBeenCalledTimes(1);
  });

  it("calls mongoose.disconnect during teardown", async () => {
    await runCLI("recall", "test");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("calls teardown even when brain.recall throws", async () => {
    mockBrain.recall.mockRejectedValue(new Error("recall failed"));
    await runCLI("recall", "test");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// maintenance command
// ═══════════════════════════════════════════════════════════════════════════════

describe("maintenance command", () => {
  it("calls brain.runMaintenance", async () => {
    await runCLI("maintenance");
    expect(mockBrain.runMaintenance).toHaveBeenCalledTimes(1);
  });

  it("prints subconscious stats", async () => {
    mockBrain.runMaintenance.mockResolvedValue({
      subStats: { decayed: 5, pruned: 2, totalProcessed: 10 },
      consciousStats: { synapsesCreated: 3 },
    });
    await runCLI("maintenance");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Subconscious: -5 decayed, -2 pruned",
    );
  });

  it("prints conscious stats", async () => {
    mockBrain.runMaintenance.mockResolvedValue({
      subStats: { decayed: 0, pruned: 0, totalProcessed: 0 },
      consciousStats: { synapsesCreated: 7 },
    });
    await runCLI("maintenance");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Conscious:    +7 synapses",
    );
  });

  it("calls connectDB and loadActions during setup", async () => {
    await runCLI("maintenance");
    expect(mockConnectDB).toHaveBeenCalledTimes(1);
    expect(mockBrain.loadActions).toHaveBeenCalledTimes(1);
  });

  it("calls mongoose.disconnect during teardown", async () => {
    await runCLI("maintenance");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("calls teardown even when runMaintenance throws", async () => {
    mockBrain.runMaintenance.mockRejectedValue(new Error("maintenance failed"));
    await runCLI("maintenance");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
