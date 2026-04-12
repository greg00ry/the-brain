import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../services/ai/intent.service.js";
import type { ILLMAdapter, LLMRequest } from "../adapters/ILLMAdapter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLLM(response: string | null): ILLMAdapter {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function makeLLMError(): ILLMAdapter {
  return { complete: vi.fn().mockRejectedValue(new Error("LLM timeout")) };
}

const ACTIONS = [
  { name: "SAVE_ONLY", description: "user states a fact or preference" },
  { name: "RESEARCH_BRAIN", description: "user asks about stored memory" },
];

const ACTIONS_WITH_CUSTOM = [
  { name: "SAVE_ONLY", description: "user states a fact or preference" },
  { name: "RESEARCH_BRAIN", description: "user asks about stored memory" },
  { name: "SEND_EMAIL", description: "user wants to send an email" },
  { name: "TRADING_SIGNAL", description: "user asks about trading signals" },
  { name: "CREATE_EVENT", description: "user wants to create a calendar event" },
];

function llmJson(action: string, confidence: number, reasoning = "test") {
  return JSON.stringify({ action, confidence, reasoning });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Rule engine high confidence (≥90) skips LLM
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 1: rule engine high confidence skips LLM", () => {
  it("explicit save command triggers SAVE_ONLY via rule, LLM not called", async () => {
    const llm = makeLLM(llmJson("RESEARCH_BRAIN", 95));
    const result = await classifyIntent({ userText: "zapamiętaj: lubię TypeScript", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("rule");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("explicit recall command triggers RESEARCH_BRAIN via rule, LLM not called", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 95));
    const result = await classifyIntent({ userText: "co wiem o Pythonie?", actions: ACTIONS }, llm);
    expect(result.action).toBe("RESEARCH_BRAIN");
    expect(result.source).toBe("rule");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("'search my memory' triggers RESEARCH_BRAIN via rule", async () => {
    const llm = makeLLM(null);
    const result = await classifyIntent({ userText: "search my memory for Python", actions: ACTIONS }, llm);
    expect(result.action).toBe("RESEARCH_BRAIN");
    expect(result.source).toBe("rule");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("'remember: ...' triggers SAVE_ONLY via rule", async () => {
    const llm = makeLLM(null);
    const result = await classifyIntent({ userText: "remember: always use const", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("rule");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("rule action must be in validActions — falls through to LLM if not", async () => {
    const customActions = [{ name: "CUSTOM_ONLY", description: "custom" }];
    const llm = makeLLM(llmJson("CUSTOM_ONLY", 90));
    // "zapamiętaj" matches SAVE_ONLY rule but SAVE_ONLY not in actions
    const result = await classifyIntent({ userText: "zapamiętaj coś", actions: customActions }, llm);
    // rule skipped because SAVE_ONLY not valid, LLM called
    expect(llm.complete).toHaveBeenCalled();
    expect(result.action).toBe("CUSTOM_ONLY");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2+3 — LLM confident (≥75) trusted
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2+3: LLM confident result trusted", () => {
  it("LLM with confidence 75 is accepted (boundary)", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 75));
    const result = await classifyIntent({ userText: "I enjoy hiking", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("llm");
    expect(result.confidence).toBe(75);
  });

  it("LLM with confidence 100 is accepted", async () => {
    const llm = makeLLM(llmJson("RESEARCH_BRAIN", 100));
    const result = await classifyIntent({ userText: "what do I know?", actions: ACTIONS }, llm);
    expect(result.action).toBe("RESEARCH_BRAIN");
    expect(result.source).toBe("llm");
  });

  it("LLM routes to custom action correctly", async () => {
    const llm = makeLLM(llmJson("SEND_EMAIL", 90));
    const result = await classifyIntent({ userText: "send an email to John", actions: ACTIONS_WITH_CUSTOM }, llm);
    expect(result.action).toBe("SEND_EMAIL");
    expect(result.source).toBe("llm");
  });

  it("LLM routes to TRADING_SIGNAL", async () => {
    const llm = makeLLM(llmJson("TRADING_SIGNAL", 85));
    const result = await classifyIntent({ userText: "what's the signal for BTC?", actions: ACTIONS_WITH_CUSTOM }, llm);
    expect(result.action).toBe("TRADING_SIGNAL");
    expect(result.source).toBe("llm");
  });

  it("LLM routes to CREATE_EVENT", async () => {
    const llm = makeLLM(llmJson("CREATE_EVENT", 80));
    const result = await classifyIntent({ userText: "add meeting tomorrow at 3pm", actions: ACTIONS_WITH_CUSTOM }, llm);
    expect(result.action).toBe("CREATE_EVENT");
    expect(result.source).toBe("llm");
  });

  it("LLM confidence 74 is NOT trusted (boundary)", async () => {
    const llm = makeLLM(llmJson("SEND_EMAIL", 74));
    const result = await classifyIntent({ userText: "some ambiguous text", actions: ACTIONS_WITH_CUSTOM }, llm);
    // no rule match → Step 5: low confidence LLM result accepted
    expect(result.source).toBe("llm");
    expect(result.confidence).toBe(74);
  });

  it("LLM returns confidence clamped to 0-100", async () => {
    const llm = makeLLM(JSON.stringify({ action: "SAVE_ONLY", confidence: 150, reasoning: "test" }));
    const result = await classifyIntent({ userText: "I like cats", actions: ACTIONS }, llm);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  it("LLM returns confidence clamped from negative", async () => {
    const llm = makeLLM(JSON.stringify({ action: "SAVE_ONLY", confidence: -10, reasoning: "test" }));
    const result = await classifyIntent({ userText: "I like cats", actions: ACTIONS }, llm);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — LLM uncertain + rule match → rule fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 4: LLM uncertain, rule match wins", () => {
  it("LLM low confidence + rule match → rule wins", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 40));
    // "what do I know about" matches RESEARCH_BRAIN rule but <90 conf (78)
    // LLM returns SAVE_ONLY with 40 — below 75
    // rule fallback kicks in
    const result = await classifyIntent({ userText: "notatki? co mam zapisane?", actions: ACTIONS }, llm);
    expect(result.source).toBe("rule");
    expect(result.action).toBe("RESEARCH_BRAIN");
    expect(result.reasoning).toContain("Rule fallback");
  });

  it("rule fallback reasoning includes LLM confidence", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 30));
    const result = await classifyIntent({ userText: "notatki?", actions: ACTIONS }, llm);
    expect(result.reasoning).toContain("30");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — LLM uncertain, no rule → take LLM anyway
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 5: LLM uncertain, no rule → accept low-confidence LLM", () => {
  it("no rule + LLM low confidence → still uses LLM result", async () => {
    const llm = makeLLM(llmJson("SEND_EMAIL", 30));
    const result = await classifyIntent({ userText: "maybe send something", actions: ACTIONS_WITH_CUSTOM }, llm);
    expect(result.action).toBe("SEND_EMAIL");
    expect(result.source).toBe("llm");
    expect(result.confidence).toBe(30);
  });

  it("LLM confidence 0 still used when no rule", async () => {
    const llm = makeLLM(llmJson("TRADING_SIGNAL", 0));
    const result = await classifyIntent({ userText: "???", actions: ACTIONS_WITH_CUSTOM }, llm);
    expect(result.action).toBe("TRADING_SIGNAL");
    expect(result.source).toBe("llm");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Default fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 6: default fallback", () => {
  it("LLM error → default fallback to first action", async () => {
    const llm = makeLLMError();
    const result = await classifyIntent({ userText: "something", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY"); // first action
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBe(0);
  });

  it("LLM returns null → default fallback", async () => {
    const llm = makeLLM(null);
    const result = await classifyIntent({ userText: "ambiguous", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("fallback");
  });

  it("LLM returns invalid JSON → default fallback", async () => {
    const llm = makeLLM("not json at all {{{{");
    const result = await classifyIntent({ userText: "ambiguous", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("fallback");
  });

  it("LLM returns unknown action → default fallback", async () => {
    const llm = makeLLM(llmJson("NONEXISTENT_ACTION", 99));
    const result = await classifyIntent({ userText: "something", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("fallback");
  });

  it("empty actions array → fallback to SAVE_ONLY string", async () => {
    const llm = makeLLM(null);
    const result = await classifyIntent({ userText: "something", actions: [] }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("fallback");
  });

  it("LLM returns empty string → default fallback", async () => {
    const llm = makeLLM("");
    const result = await classifyIntent({ userText: "something", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("fallback");
  });

  it("LLM returns action name with wrong case → rejected, fallback", async () => {
    const llm = makeLLM(llmJson("save_only", 95));
    // text must NOT match any rule so step 4 doesn't catch it
    const result = await classifyIntent({ userText: "please handle xyz789", actions: ACTIONS }, llm);
    // "save_only" !== "SAVE_ONLY" — invalid action, no rule match → fallback
    expect(result.source).toBe("fallback");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Many custom actions
// ═══════════════════════════════════════════════════════════════════════════════

describe("custom actions routing", () => {
  const MANY_ACTIONS = [
    { name: "SAVE_ONLY", description: "save facts" },
    { name: "RESEARCH_BRAIN", description: "recall from memory" },
    { name: "SEND_EMAIL", description: "send email" },
    { name: "TRADING_SIGNAL", description: "trading analysis" },
    { name: "CREATE_EVENT", description: "create calendar event" },
    { name: "SEARCH_WEB", description: "search the internet" },
    { name: "QUICK_NOTE", description: "jot down a quick note" },
  ];

  it("routes to each custom action when LLM confident", async () => {
    const customActions = ["SEND_EMAIL", "TRADING_SIGNAL", "CREATE_EVENT", "SEARCH_WEB", "QUICK_NOTE"];
    for (const action of customActions) {
      const llm = makeLLM(llmJson(action, 90));
      const result = await classifyIntent({ userText: "some text", actions: MANY_ACTIONS }, llm);
      expect(result.action).toBe(action);
      expect(result.source).toBe("llm");
    }
  });

  it("first action is default fallback even with many actions", async () => {
    const llm = makeLLMError();
    const result = await classifyIntent({ userText: "something", actions: MANY_ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("fallback");
  });

  it("LLM cannot route to action not in list → fallback to first action", async () => {
    const llm = makeLLM(llmJson("DELETE_ALL", 99));
    const result = await classifyIntent({ userText: "delete everything", actions: MANY_ACTIONS }, llm);
    expect(result.source).toBe("fallback");
    // fallback always returns actions[0] — a valid action, not the invalid LLM suggestion
    expect(result.action).toBe(MANY_ACTIONS[0].name);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Chat history included in prompt
// ═══════════════════════════════════════════════════════════════════════════════

describe("chat history in prompt", () => {
  it("prompt includes all action names", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 80));
    await classifyIntent({ userText: "test", actions: ACTIONS_WITH_CUSTOM }, llm);
    const calledPrompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMRequest;
    for (const action of ACTIONS_WITH_CUSTOM) {
      expect(calledPrompt.userPrompt).toContain(action.name);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LLM response format edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM response format edge cases", () => {
  it("handles JSON wrapped in markdown code block", async () => {
    const llm = makeLLM("```json\n" + llmJson("SAVE_ONLY", 80) + "\n```");
    const result = await classifyIntent({ userText: "I love Rust", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("llm");
  });

  it("handles JSON with extra whitespace", async () => {
    const llm = makeLLM("  \n  " + llmJson("RESEARCH_BRAIN", 80) + "  \n  ");
    const result = await classifyIntent({ userText: "what do I know?", actions: ACTIONS }, llm);
    expect(result.action).toBe("RESEARCH_BRAIN");
  });

  it("handles missing confidence field → defaults to 50", async () => {
    const llm = makeLLM(JSON.stringify({ action: "SAVE_ONLY", reasoning: "test" }));
    // text must NOT match any rule — step 5 returns the low-confidence LLM result
    const result = await classifyIntent({ userText: "please process xyz789", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.confidence).toBe(50);
  });

  it("handles missing reasoning field → defaults to 'no reason'", async () => {
    const llm = makeLLM(JSON.stringify({ action: "SAVE_ONLY", confidence: 80 }));
    const result = await classifyIntent({ userText: "I like cats", actions: ACTIONS }, llm);
    expect(result.reasoning).toBe("no reason");
  });

  it("handles JSON with text before/after", async () => {
    const llm = makeLLM("Here is my response: " + llmJson("SAVE_ONLY", 80) + " done.");
    const result = await classifyIntent({ userText: "I prefer tabs", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structural routing: question + SAVE_ONLY → RESEARCH_BRAIN
// ═══════════════════════════════════════════════════════════════════════════════

describe("Structural routing: question redirected from SAVE_ONLY to RESEARCH_BRAIN", () => {
  it("LLM SAVE_ONLY for a question → overridden to RESEARCH_BRAIN", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 85));
    const result = await classifyIntent({ userText: "Co sądzisz o multi-query recall?", actions: ACTIONS }, llm);
    expect(result.action).toBe("RESEARCH_BRAIN");
    expect(result.source).toBe("rule");
  });

  it("LLM SAVE_ONLY for a question → confidence is 88", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 90));
    const result = await classifyIntent({ userText: "What do you think about this approach?", actions: ACTIONS }, llm);
    expect(result.confidence).toBe(88);
  });

  it("LLM TRADING_SIGNAL for a question → NOT overridden (custom action preserved)", async () => {
    const llm = makeLLM(llmJson("TRADING_SIGNAL", 85));
    const result = await classifyIntent({ userText: "what's the signal for BTC?", actions: ACTIONS_WITH_CUSTOM }, llm);
    expect(result.action).toBe("TRADING_SIGNAL");
    expect(result.source).toBe("llm");
  });

  it("LLM SAVE_ONLY for non-question → NOT overridden", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 85));
    const result = await classifyIntent({ userText: "I think Python is great", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("llm");
  });

  it("explicit save command with '?' still routes to SAVE_ONLY (rule wins before LLM)", async () => {
    const llm = makeLLM(llmJson("RESEARCH_BRAIN", 95));
    const result = await classifyIntent({ userText: "zapamiętaj: co to jest?", actions: ACTIONS }, llm);
    expect(result.action).toBe("SAVE_ONLY");
    expect(result.source).toBe("rule");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("LLM SAVE_ONLY with low confidence + question → rule fallback already handles it via RESEARCH_BRAIN", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 50));
    const result = await classifyIntent({ userText: "Jakie mam notatki?", actions: ACTIONS }, llm);
    // "Jakie mam notatki?" matches the memory-keywords rule (78%) as fallback
    expect(result.action).toBe("RESEARCH_BRAIN");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Intent points (embedding-based)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2: intent points skip LLM when similarity is high", () => {
  function makeStorage(similarity: number, actionName = "TRADING_SIGNAL") {
    return {
      findNearestIntentAction: vi.fn().mockResolvedValue([{ actionName, similarity }]),
    } as any;
  }

  function makeEmbedding() {
    return { embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
  }

  it("skips LLM when similarity >= threshold", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 90));
    const result = await classifyIntent({
      userText: "what's bitcoin doing?",
      actions: ACTIONS_WITH_CUSTOM,
      storage: makeStorage(0.90),
      embeddingAdapter: makeEmbedding(),
    }, llm);
    expect(result.action).toBe("TRADING_SIGNAL");
    expect(result.source).toBe("rule");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("falls through to LLM when similarity < threshold", async () => {
    const llm = makeLLM(llmJson("TRADING_SIGNAL", 80));
    const result = await classifyIntent({
      userText: "something vague",
      actions: ACTIONS_WITH_CUSTOM,
      storage: makeStorage(0.70),
      embeddingAdapter: makeEmbedding(),
    }, llm);
    expect(llm.complete).toHaveBeenCalled();
  });

  it("skips intent points step when no embeddingAdapter provided", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 90));
    const storage = makeStorage(0.99);
    await classifyIntent({
      userText: "what's bitcoin doing?",
      actions: ACTIONS_WITH_CUSTOM,
      storage,
    }, llm);
    expect(storage.findNearestIntentAction).not.toHaveBeenCalled();
  });

  it("skips intent points step when no storage provided", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 90));
    const embedding = makeEmbedding();
    await classifyIntent({
      userText: "what's bitcoin doing?",
      actions: ACTIONS_WITH_CUSTOM,
      embeddingAdapter: embedding,
    }, llm);
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it("falls through to LLM when action from intent points is not in validActions", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 90));
    await classifyIntent({
      userText: "something",
      actions: ACTIONS, // does not include TRADING_SIGNAL
      storage: makeStorage(0.95, "TRADING_SIGNAL"),
      embeddingAdapter: makeEmbedding(),
    }, llm);
    expect(llm.complete).toHaveBeenCalled();
  });

  it("continues silently when embedding throws", async () => {
    const llm = makeLLM(llmJson("SAVE_ONLY", 90));
    const badEmbedding = { embed: vi.fn().mockRejectedValue(new Error("embed failed")) };
    const result = await classifyIntent({
      userText: "test",
      actions: ACTIONS,
      storage: makeStorage(0.99),
      embeddingAdapter: badEmbedding,
    }, llm);
    expect(result).toBeDefined();
    expect(llm.complete).toHaveBeenCalled();
  });
});
