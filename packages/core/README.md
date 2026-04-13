# @the-brain/core

[![npm](https://img.shields.io/npm/v/@the-brain/core)](https://www.npmjs.com/package/@the-brain/core)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/greg00ry/the-brain/blob/main/LICENSE)

> What SQLite is to databases, The Brain is to agent memory — zero-config, single-file, no server, just works.

---

## Why The Brain

- **Single SQLite file out of the box.** No Postgres, no Qdrant, no Redis. `npm install`, point to a file path, done. Upgrade to MongoDB when you need it.
- **TypeScript-first.** Not a Python library with JS bindings. Types all the way down.
- **Any OpenAI-compatible endpoint.** Ollama, LM Studio, Groq, OpenAI — swap by changing a URL and a model name. Local LLMs are first-class, not an afterthought.
- **Memory that decays.** Entries lose strength over time and get pruned automatically. Context stays relevant instead of becoming an ever-growing pile.
- **Brain without plugins does nothing.** Memory, saving, querying — everything is a registered action. You keep what you need, add what you want.

---

## Quick start

```bash
npm install @the-brain/core @the-brain/adapter-sqlite
```

```typescript
import { Brain, OpenAICompatibleAdapter, SavingPlugin, MemoryPlugin } from "@the-brain/core";
import { SQLiteStorageAdapter } from "@the-brain/adapter-sqlite";

const brain = new Brain(
  new OpenAICompatibleAdapter(
    "http://localhost:11434/v1/chat/completions",
    "qwen2.5:7b"  // must support tool calling — see model table below
  ),
  new SQLiteStorageAdapter("./.brain")  // creates .brain/brain.db on first run
);

// Register built-in actions (or bring your own)
await brain.use(new SavingPlugin(), new MemoryPlugin());

// Save a fact
await brain.save("user-1", "I prefer functional style over OOP");

// Route intent and execute — Brain picks SAVE_ONLY or RESEARCH_BRAIN automatically
const result = await brain.process("user-1", "What do I know about my coding preferences?");
console.log(result.answer);

// Skip routing — query memory directly
const context = await brain.recall("user-1", "coding style preferences");
console.log(context.synapticTree);
```

---

## How memory works

Memory entries aren't stored and retrieved — they live, age, and die.

**Strength and decay.** Every entry starts with a strength value of 5. The subconscious routine runs after every N saves and decrements strength by 1 for any entry inactive longer than 7 days (configurable). At 0, the entry is deleted. No manual cleanup. Think of it as gradual cache eviction, not hard expiry — frequently accessed entries stay alive naturally.

**Synapses.** The conscious processor scans new entries and builds weighted edges between related ones. When you recall something, traversal follows synaptic paths on top of direct matches — so "Python" connects to "I prefer functional style" connects to "I avoid classes where possible". Flat vector search misses these chains. Synapse depth and branch factor are configurable.

**Two synapse modes.** `synapseMode: "llm"` (default) sends entries to the LLM and asks it to find meaningful connections — it understands context across entries the way a person would, not just word similarity. `synapseMode: "embedding"` uses cosine similarity instead: cheaper, deterministic, no LLM call. Pick based on your cost/quality tradeoff.

**Subconscious vs conscious.** The subconscious routine is pure math — no LLM, no cost — just strength decay and dead synapse pruning. It runs in the background every N saves. The conscious processor is LLM-driven: it analyzes new entries in batches of 5, finds relationships, and builds synapses. Think of it as background GC (subconscious) plus a periodic indexing job (conscious).

**Permanent entries.** `isPermanent=true` disables decay entirely and sets strength to 10. Use it for ingested documents, hard user preferences, anything that should never expire. Everything else ages naturally.

```
Entry saved (strength=5)
  → [every N saves] conscious processor: analyze batch, build synapses
  → [every N saves] subconscious routine: decay inactive, prune dead
  → strength reaches 0 → entry + its synapses deleted
  → isPermanent=true → never decays, never pruned
```

Run maintenance manually at any time:

```typescript
const { subStats, consciousStats } = await brain.runMaintenance();
// subStats:      { decayed: 3, pruned: 1, totalProcessed: 47 }
// consciousStats: { analyzed: 5, synapsesCreated: 8 }
```

---

## Works with any LLM

Brain uses the OpenAI tool calling API for intent routing. The model must support `tools`. Tested:

| Model | Size | Tool calling |
|---|---|---|
| `qwen2.5:7b` (Ollama) | 4.7 GB | ✅ recommended local |
| `qwen2.5:3b` (Ollama) | 1.9 GB | ✅ lighter local option |
| `llama3.1:8b` (Ollama) | 4.7 GB | ✅ |
| `mistral:7b` (Ollama) | 4.1 GB | ✅ |
| `llama-3.3-70b-versatile` (Groq) | — | ✅ free tier |
| `gpt-4o` (OpenAI) | — | ✅ |
| `llama3.2` (Ollama) | 2.0 GB | ❌ no tool calling |

```typescript
// Local (Ollama)
new OpenAICompatibleAdapter("http://localhost:11434/v1/chat/completions", "qwen2.5:7b")

// Groq — free, no GPU needed
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

---

## Packages

| Package | Description |
|---|---|
| [`@the-brain/core`](https://www.npmjs.com/package/@the-brain/core) | Framework — Brain class, plugin system, memory mechanics, adapters |
| [`@the-brain/adapter-sqlite`](https://www.npmjs.com/package/@the-brain/adapter-sqlite) | SQLite storage — zero-config, single file, Node.js >= 22.5 |
| [`@the-brain/adapter-mongo`](https://www.npmjs.com/package/@the-brain/adapter-mongo) | MongoDB storage — recommended for multi-user and production scale |
| [`@the-brain/cli`](https://www.npmjs.com/package/@the-brain/cli) | CLI — `brain save`, `brain process`, `brain recall`, PDF ingest, interactive chat |

---

## Plugins

Brain without plugins does nothing — there are no built-in actions. This is intentional. You register what your agent needs.

`brain.use()` runs each plugin's `register()` method, which calls `brain.registerAction()` internally. The action description is what the LLM sees when routing via tool calling — write it like a function docstring.

**Built-in plugins** (import from `@the-brain/core`):

```typescript
// SavingPlugin — registers SAVE_ONLY action
// Routes when user states facts, preferences, or wants to store something
await brain.use(new SavingPlugin());

// MemoryPlugin — registers RESEARCH_BRAIN action
// Routes when user asks questions about past notes or stored knowledge
await brain.use(new MemoryPlugin());

// Custom system prompt per plugin:
await brain.use(new SavingPlugin({ systemPrompt: "You are a terse assistant. Confirm saves in one sentence." }));
```

**Custom plugins** — implement `BrainPlugin` or just call `registerAction` directly:

```typescript
// Inline — no class needed
await brain.registerAction(
  "TRADING_SIGNAL",
  "user asks about trading signals, market analysis, or price targets",
  async (userId, text, { synapticTree, relevantEntries, hasContext }, llm, chatHistory) => {
    // synapticTree: graph-traversed context as a formatted string
    // relevantEntries: raw matched VaultEntry objects
    // hasContext: false if memory is empty — handle gracefully
    return `Signal: BUY BTC — confidence 72%\n\nContext: ${synapticTree}`;
  }
);

// As a reusable plugin class:
class TradingPlugin implements BrainPlugin {
  async register(brain: Brain) {
    await brain.registerAction("TRADING_SIGNAL", "user asks about trading signals", handler);
  }
}
// That's the entire plugin.
```

When `brain.process()` runs, it sends all registered action names and descriptions to the LLM as tools and lets it pick. No regex, no keyword matching.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    brain.process()                       │
│              brain.run() — ReAct loop                    │
└────────────────────┬────────────────────────────────────┘
                     │ native tool calling
         ┌───────────▼───────────┐
         │    Action Registry    │  ← registerAction() / brain.use()
         │  SAVE_ONLY            │
         │  RESEARCH_BRAIN       │
         │  YOUR_ACTION          │
         └───────────┬───────────┘
                     │
        ┌────────────▼────────────┐
        │     Memory Layer        │
        │  recall() → synapticTree│  ← graph traversal + vector similarity
        │  save()   → VaultEntry  │  ← strength=5, isPermanent=false
        └────────────┬────────────┘
                     │
         ┌───────────▼───────────┐
         │   Storage Adapter     │  ← SQLiteStorageAdapter | MongoStorageAdapter
         └───────────────────────┘
```

`brain.process()` is single-shot: classify → execute → return. `brain.run()` is a ReAct loop: it feeds tool results back to the LLM and iterates up to N times, useful when actions need multiple steps or produce intermediate observations.

---

## SQLite vs MongoDB

Start with SQLite. Migrate to MongoDB when you need multi-user at scale or want the MongoDB query planner for graph traversal.

| Feature | SQLite | MongoDB |
|---|---|---|
| Setup | Zero — one file path | Requires running server |
| Synaptic graph traversal | ✅ | ✅ |
| Atomic strength decay | ✅ | ✅ |
| Embedding similarity search | ✅ (JS cosine) | ✅ (JS cosine) |
| Multi-user at scale | ⚠️ SQLite write locks | ✅ |
| Node.js requirement | >= 22.5 (built-in `node:sqlite`) | any |

---

## CLI

```bash
npm install -g @the-brain/cli

brain                                         # interactive chat
brain save "I prefer tabs over spaces"        # save a fact
brain save "Core architecture decision" --permanent  # never decays
brain process "What do I prefer for indentation?"   # route + answer
brain recall "indentation"                    # direct memory search
brain ingest ./docs/ --chunk-size 800         # ingest PDFs as permanent memory
brain maintenance                             # run decay + consolidation manually
```

See [`@the-brain/cli`](https://www.npmjs.com/package/@the-brain/cli) for full setup.

---

## Config

```typescript
const brain = new Brain(llm, storage, embedding, {
  llm: {
    responseMaxTokens: 3000,   // default: 1500
    saveMaxTokens: 500,        // default: 300
  },
  memory: {
    synapseTreeDepth: 7,       // default: 5 — how deep graph traversal goes
    synapseBranchFactor: 7,    // default: 5 — max edges per node
    contextTopEntries: 8,      // default: 5 — entries passed to handler
    decayWindowMs: 30 * 24 * 60 * 60 * 1000, // default: 7 days
    synapseMode: "embedding",  // "llm" (default) | "embedding" (cheaper)
  },
  chat: {
    historyMaxStored: 20,      // default: 10 — sliding window per user
    maintenanceEveryN: 50,     // default: 20 — saves between maintenance runs
    profileUpdateEveryN: 5,    // default: 10 — conversations between profile updates
  },
});
```

---

## License

AGPL-3.0 — [github.com/greg00ry/the-brain](https://github.com/greg00ry/the-brain)

For personal tools, internal apps, and open-source projects: AGPL is fine, no restrictions. For commercial SaaS where you'd rather not open-source your product code, reach out.

---

**Author:** Grzegorz Trzaskoma — Warsaw, Poland
