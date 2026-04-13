# @the-brain/core

LLM-agnostic cognitive memory framework with biologically-inspired decay, synapses, and Graph RAG.

## What it does

- **Memory that forgets** — entries decay over time, strong ones get consolidated to long-term memory
- **Synaptic connections** — weighted links between related entries, traversed like a graph
- **Native tool calling** — intent routing via OpenAI-compatible `tools` API (no JSON parsing hacks)
- **ReAct agentic loop** — `brain.run()` with Reason→Act→Observe, multi-step execution
- **User profile adaptation** — Brain learns your communication style and adapts responses
- **PDF ingest** — feed documents as permanent memory (`isPermanent=true`, never decays)

## Install

```bash
npm install @the-brain/core
# plus a storage adapter:
npm install @the-brain/adapter-mongo   # MongoDB (recommended)
npm install @the-brain/adapter-sqlite  # SQLite (zero-config)
```

## Quick start

```typescript
import { Brain, OpenAICompatibleAdapter } from "@the-brain/core";
import { SQLiteStorageAdapter } from "@the-brain/adapter-sqlite";

const brain = new Brain(
  new OpenAICompatibleAdapter(
    "http://localhost:11434/v1/chat/completions",
    "qwen2.5:7b"  // local, supports tool calling
  ),
  new SQLiteStorageAdapter("./.brain")
);

await brain.use(new SavingPlugin(), new MemoryPlugin());

// Save a fact
await brain.save("user-1", "I prefer TypeScript over JavaScript");

// Route intent via native tool calling + execute handler
const result = await brain.process("user-1", "What do I prefer for coding?");
console.log(result.answer);

// Multi-step ReAct loop (Reason → Act → Observe)
const result = await brain.run("user-1", "What do I know about TypeScript?");
console.log(result.answer);

// Direct memory recall
const context = await brain.recall("user-1", "TypeScript preferences");
console.log(context.synapticTree);
```

## Local LLM requirement: tool calling support

Brain routes intent using the OpenAI `tools` API — the model **must** support tool calling.

| Model | Size | Tool calling | Notes |
|---|---|---|---|
| `qwen2.5:7b` | 4.4 GB | ✅ | Recommended local default |
| `qwen2.5:3b` | 1.9 GB | ✅ | Lighter option |
| `llama3.1:8b` | 4.7 GB | ✅ | Meta, solid alternative |
| `mistral:7b` | 4.1 GB | ✅ | Fast, reliable |
| `llama3.2:3b` | 2.0 GB | ❌ | No tool calling support |
| `llama3:8b` | 4.7 GB | ❌ | No tool calling support |

```bash
# Recommended local setup:
ollama pull qwen2.5:7b
```

## Works with any LLM

```typescript
// Local (Ollama) — tool calling supported
new OpenAICompatibleAdapter("http://localhost:11434/v1/chat/completions", "qwen2.5:7b")

// Groq (free, fast)
new OpenAICompatibleAdapter(
  "https://api.groq.com/openai/v1/chat/completions",
  "llama-3.3-70b-versatile",
  process.env.GROQ_API_KEY
)

// OpenAI
new OpenAICompatibleAdapter(
  "https://api.openai.com/v1/chat/completions",
  "gpt-4o",
  process.env.OPENAI_API_KEY
)
```

## Custom actions

```typescript
await brain.registerAction(
  "TRADING_SIGNAL",
  "user asks about trading signals or market analysis",
  async (userId, text, { synapticTree }, llm) => {
    // your handler logic
    return "Signal: BUY BTC — confidence 72%";
  }
);
```

## process() vs run()

```typescript
// process() — single-shot: classify intent → execute handler → return
const result = await brain.process("user-1", "Save this note");

// run() — ReAct loop: iterate Reason→Act→Observe up to N times
// Use when actions may need multiple steps or tool chaining
const result = await brain.run("user-1", "What did I save about trading?", 5);
```

## Config overrides

```typescript
const brain = new Brain(llm, storage, embedding, {
  llm: {
    responseMaxTokens: 3000,   // default: 1500
    saveMaxTokens: 500,        // default: 300
  },
  memory: {
    synapseTreeDepth: 7,       // default: 5
    synapseBranchFactor: 7,    // default: 5
    contextTopEntries: 8,      // default: 5
    decayWindowMs: 30 * 24 * 60 * 60 * 1000, // default: 7 days
    synapseMode: "embedding",  // "llm" (default, richer) | "embedding" (faster)
  },
  chat: {
    historyMaxStored: 20,      // default: 10
    maintenanceEveryN: 50,     // default: 20
    profileUpdateEveryN: 5,    // default: 10
  },
});
```

## Memory lifecycle

```
Save entry (strength=5)
  → Conscious processor: analyze, build synapses, consolidate strong entries to LTM
  → Subconscious routine: decay inactive entries, prune dead ones
  → Long-term memory: strength ≥ 10 → permanent summary created
```

Run maintenance manually or let Brain trigger it automatically every N saves:

```typescript
const { subStats, consciousStats } = await brain.runMaintenance();
```

## License

AGPL-3.0 — [github.com/greg00ry/the-brain](https://github.com/greg00ry/the-brain)
