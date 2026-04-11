import { describe, it, expect } from "vitest";
import { ANALYZE_PROMPT } from "../services/ai/prompts/analyze.prompt.js";
import { ANALYZE_WITH_SYNAPSES_PROMPT } from "../services/ai/prompts/analyze-with-synapses.prompt.js";

import { PERSONALITY_SYSTEM_PROMPT } from "../services/ai/prompts/personality.prompt.js";
import { RESEARCH_ANSWER_PROMPT } from "../services/ai/prompts/research-answer.prompt.js";
import { SAVE_RESPONSE_PROMPT } from "../services/ai/prompts/save-response.prompt.js";

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYZE_PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

describe("ANALYZE_PROMPT", () => {
  it("contains the input text", () => {
    const result = ANALYZE_PROMPT("Python is great");
    expect(result).toContain("Python is great");
  });

  it("requests summary and strength fields", () => {
    const result = ANALYZE_PROMPT("text");
    expect(result).toContain("summary");
    expect(result).toContain("strength");
  });

  it("instructs to return only valid JSON", () => {
    const result = ANALYZE_PROMPT("text");
    expect(result).toContain("JSON");
  });

  it("mentions strength scale 1-10", () => {
    const result = ANALYZE_PROMPT("text");
    expect(result).toMatch(/1-10|1–10/);
  });

  it("works with empty string input", () => {
    const result = ANALYZE_PROMPT("");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("works with multiline text", () => {
    const text = "line one\nline two\nline three";
    const result = ANALYZE_PROMPT(text);
    expect(result).toContain("line one");
    expect(result).toContain("line three");
  });

  it("returns a string", () => {
    expect(typeof ANALYZE_PROMPT("test")).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYZE_WITH_SYNAPSES_PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

describe("ANALYZE_WITH_SYNAPSES_PROMPT", () => {
  it("contains both inputs", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("new entry data", "old entry data");
    expect(result).toContain("new entry data");
    expect(result).toContain("old entry data");
  });

  it("requests topics and synapses arrays in JSON", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("delta", "ctx");
    expect(result).toContain("topics");
    expect(result).toContain("synapses");
  });

  it("specifies sourceId must come from new entries", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("delta", "ctx");
    expect(result).toContain("sourceId");
    expect(result.toLowerCase()).toContain("new");
  });

  it("mentions max 3 synapses per new entry", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("delta", "ctx");
    expect(result).toContain("3");
  });

  it("instructs to return only valid JSON", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("delta", "ctx");
    expect(result).toContain("JSON");
  });

  it("includes strength scale 1-10", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("delta", "ctx");
    expect(result).toMatch(/1-10|1–10/);
  });

  it("works with empty strings", () => {
    const result = ANALYZE_WITH_SYNAPSES_PROMPT("", "");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PERSONALITY_SYSTEM_PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

describe("PERSONALITY_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof PERSONALITY_SYSTEM_PROMPT).toBe("string");
    expect(PERSONALITY_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("identifies as The Brain", () => {
    expect(PERSONALITY_SYSTEM_PROMPT).toContain("The Brain");
  });

  it("instructs to respond in Polish or English based on user language", () => {
    expect(PERSONALITY_SYSTEM_PROMPT.toLowerCase()).toMatch(/polsk|english|angielsk/i);
  });

  it("instructs short responses (2-3 sentences)", () => {
    expect(PERSONALITY_SYSTEM_PROMPT).toMatch(/2-3|2–3/);
  });

  it("forbids responding with just 'Zapisano' or 'OK'", () => {
    expect(PERSONALITY_SYSTEM_PROMPT).toContain("Zapisano");
    // The prompt instructs NOT to use these — verify the instruction exists
    expect(PERSONALITY_SYSTEM_PROMPT.toLowerCase()).toMatch(/nigdy|never|nie odpowiadaj/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESEARCH_ANSWER_PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

describe("RESEARCH_ANSWER_PROMPT", () => {
  it("contains user text and context", () => {
    const result = RESEARCH_ANSWER_PROMPT("co wiem o Pythonie?", "Python jest szybki.");
    expect(result).toContain("co wiem o Pythonie?");
    expect(result).toContain("Python jest szybki.");
  });

  it("does not include CONVERSATION HISTORY section when no history provided", () => {
    const result = RESEARCH_ANSWER_PROMPT("question", "context");
    expect(result).not.toContain("CONVERSATION HISTORY");
  });

  it("does not include CONVERSATION HISTORY section when history is empty array", () => {
    const result = RESEARCH_ANSWER_PROMPT("question", "context", []);
    expect(result).not.toContain("CONVERSATION HISTORY");
  });

  it("includes CONVERSATION HISTORY section when history provided", () => {
    const history = [{ role: "user", content: "earlier message" }];
    const result = RESEARCH_ANSWER_PROMPT("question", "context", history);
    expect(result).toContain("CONVERSATION HISTORY");
    expect(result).toContain("earlier message");
  });

  it("maps 'user' role to 'User' label in history", () => {
    const history = [{ role: "user", content: "my question" }];
    const result = RESEARCH_ANSWER_PROMPT("q", "ctx", history);
    expect(result).toContain("User: my question");
  });

  it("maps non-user role to 'Brain' label in history", () => {
    const history = [{ role: "assistant", content: "my answer" }];
    const result = RESEARCH_ANSWER_PROMPT("q", "ctx", history);
    expect(result).toContain("Brain: my answer");
  });

  it("uses only last 5 messages from history", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      role: "user",
      content: `message ${i}`,
    }));
    const result = RESEARCH_ANSWER_PROMPT("q", "ctx", history);
    expect(result).not.toContain("message 0");
    expect(result).not.toContain("message 1");
    expect(result).not.toContain("message 2");
    expect(result).toContain("message 7");
  });

  it("contains MEMORY CONTEXT section", () => {
    const result = RESEARCH_ANSWER_PROMPT("q", "some memories");
    expect(result).toContain("MEMORY CONTEXT");
    expect(result).toContain("some memories");
  });

  it("returns a string", () => {
    expect(typeof RESEARCH_ANSWER_PROMPT("q", "ctx")).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SAVE_RESPONSE_PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

describe("SAVE_RESPONSE_PROMPT", () => {
  it("contains the input text", () => {
    const result = SAVE_RESPONSE_PROMPT("Uczę się Rusta");
    expect(result).toContain("Uczę się Rusta");
  });

  it("does not include OSTATNIA ROZMOWA section when no history", () => {
    const result = SAVE_RESPONSE_PROMPT("text");
    expect(result).not.toContain("OSTATNIA ROZMOWA");
  });

  it("does not include OSTATNIA ROZMOWA section when history is empty array", () => {
    const result = SAVE_RESPONSE_PROMPT("text", []);
    expect(result).not.toContain("OSTATNIA ROZMOWA");
  });

  it("includes OSTATNIA ROZMOWA section when history provided", () => {
    const history = [{ role: "user", content: "poprzednia wiadomość" }];
    const result = SAVE_RESPONSE_PROMPT("text", history);
    expect(result).toContain("OSTATNIA ROZMOWA");
    expect(result).toContain("poprzednia wiadomość");
  });

  it("maps 'user' role to 'User' label in history", () => {
    const history = [{ role: "user", content: "moja wiadomość" }];
    const result = SAVE_RESPONSE_PROMPT("text", history);
    expect(result).toContain("User: moja wiadomość");
  });

  it("maps non-user role to 'Brain' label in history", () => {
    const history = [{ role: "assistant", content: "odpowiedź asystenta" }];
    const result = SAVE_RESPONSE_PROMPT("text", history);
    expect(result).toContain("Brain: odpowiedź asystenta");
  });

  it("uses only last 5 messages from history", () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      role: "user",
      content: `msg ${i}`,
    }));
    const result = SAVE_RESPONSE_PROMPT("text", history);
    expect(result).not.toContain("msg 0");
    expect(result).not.toContain("msg 1");
    expect(result).toContain("msg 6");
  });

  it("instructs not to write 'Zapisano'", () => {
    const result = SAVE_RESPONSE_PROMPT("text");
    expect(result).toContain("Zapisano");
    // verify it's an instruction to avoid it
    expect(result.toLowerCase()).toMatch(/nie pisz|not write/i);
  });

  it("instructs to ask ONE follow-up question", () => {
    const result = SAVE_RESPONSE_PROMPT("text");
    expect(result).toMatch(/jedno|one/i);
  });

  it("returns a string", () => {
    expect(typeof SAVE_RESPONSE_PROMPT("test")).toBe("string");
  });
});
