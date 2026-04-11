# The Brain

> **LLM-agnostic cognitive memory framework**

[![CI](https://github.com/greg00ry/the-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/greg00ry/the-brain/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

---

## What Is This?

Infrastructure for building AI agents with memory — not a wrapper around an API, not a chatbot template.

**The core insight:** AI models work better when you design the environment around them. Good context, relevant memory, clear action boundaries — these make a weak local model competitive with cloud.

The Brain provides:
- **Hybrid intent routing** — rules + LLM + confidence scoring, works reliably with local or cloud
- **Biologically-inspired memory** — strength-based decay, synapses, Graph RAG, long-term consolidation
- **Dynamic action registry** — extensible, DB-backed, build any agent on top
- **User profile adaptation** — Brain learns your communication style over time
- **LLM agnostic** — any OpenAI-compatible endpoint, local or cloud

---

## Quick Start

```bash
npm install @the-brain/core @the-brain/adapter-sqlite
```

```typescript
import { Brain, OpenAICompatibleAdapter, SavingPlugin, MemoryPlugin } from "@the-brain/core";
import { SQLiteStorageAdapter } from "@the-brain/adapter-sqlite";

const brain = new Brain(
  new OpenAICompatibleAdapter(
    "http://localhost:11434/v1/chat/completions", // Ollama, LM Studio, Groq, OpenAI — anything OpenAI-compatible
    "llama3.2"
  ),
  new SQLiteStorageAdapter("./.brain")
);

await brain.use(
  new SavingPlugin(),   // enables SAVE_ONLY action
  new MemoryPlugin(),   // enables RESEARCH_BRAIN action
);

// Save a fact
await brain.save("user-1", "I prefer functional programming");

// Ask a question — Brain routes intent and searches memory
const result = await brain.process("user-1", "What do I prefer for coding?");
console.log(result.answer);
```

Zero config. Single file (`brain.db`). No server. Requires Node.js >= 22.5.

---

## Packages

| Package | Description | npm |
|---|---|---|
| `@the-brain/core` | Core framework — Brain class, intent routing, memory | [![npm](https://img.shields.io/npm/v/@the-brain/core)](https://www.npmjs.com/package/@the-brain/core) |
| `@the-brain/adapter-sqlite` | SQLite storage — zero-config, single file (Node >= 22.5) | [![npm](https://img.shields.io/npm/v/@the-brain/adapter-sqlite)](https://www.npmjs.com/package/@the-brain/adapter-sqlite) |
| `@the-brain/adapter-mongo` | MongoDB storage — full Graph RAG, synapses, multi-user | [![npm](https://img.shields.io/npm/v/@the-brain/adapter-mongo)](https://www.npmjs.com/package/@the-brain/adapter-mongo) |
| `@the-brain/cli` | CLI — chat, save, recall, ingest PDFs, maintenance | [![npm](https://img.shields.io/npm/v/@the-brain/cli)](https://www.npmjs.com/package/@the-brain/cli) |

---

## Works With Any LLM

```typescript
// Local — Ollama
new OpenAICompatibleAdapter("http://localhost:11434/v1/chat/completions", "llama3.2")

// Local — LM Studio
new OpenAICompatibleAdapter("http://localhost:1234/v1/chat/completions", "local-model")

// Groq (free, fast, no GPU needed)
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

## Plugins

Brain has no built-in actions. Everything is a plugin — including memory.

```typescript
import { Brain, SavingPlugin, MemoryPlugin, type BrainPlugin } from "@the-brain/core";

// Built-in plugins:
await brain.use(new SavingPlugin());   // SAVE_ONLY — stores facts
await brain.use(new MemoryPlugin());   // RESEARCH_BRAIN — searches memory

// Custom plugin:
class TradingPlugin implements BrainPlugin {
  async register(brain: Brain) {
    await brain.registerAction(
      "TRADING_SIGNAL",
      "user asks about trading signals or market analysis",
      async (_userId, text, { synapticTree, hasContext }) => {
        const context = hasContext ? `\nRelevant memory:\n${synapticTree}` : "";
        const answer = await brain.llm.complete({
          userPrompt: `Analyze: "${text}"${context}`,
          temperature: 0.3,
          maxTokens: 300,
        });
        return answer ?? "Could not analyze.";
      },
    );
  }
}

await brain.use(new TradingPlugin());
```

Legal assistant, trading agent, medical notes, dev assistant — same framework, different plugins.

---

## Memory Lifecycle

```
Entry saved (strength=5)
  │
  ├── Conscious processor (LLM-driven, every N saves)
  │     Analyzes entries → builds synapses → consolidates strong ones to LTM
  │
  └── Subconscious routine (pure math, no LLM)
        Inactive entries lose strength → strength=0 → pruned
        Dead synapses pruned
        strength ≥ 10 → consolidated to long-term memory
```

Entries marked `isPermanent` never decay — use for ingested documents and critical knowledge.

---

## PDF Ingest

Feed documents as permanent memory via the CLI:

```bash
brain ingest ./legal_docs/       # entire folder
brain ingest ./manual.pdf        # single file
brain ingest ./report.pdf --chunk-size 800 --overlap 150
```

Or programmatically:

```typescript
await brain.save(userId, "[PDF: contract.pdf, chunk 1/42]\nArticle 1...", true); // isPermanent=true
```

---

## MongoDB (Full Features)

```bash
npm install @the-brain/core @the-brain/adapter-mongo mongoose
```

```typescript
import { MongoStorageAdapter, connectDB } from "@the-brain/adapter-mongo";

await connectDB(); // reads MONGODB_URI from env

const brain = new Brain(llm, new MongoStorageAdapter());
```

| Feature | SQLite | MongoDB |
|---|---|---|
| Zero config | ✅ | ❌ |
| Synaptic graph traversal | ✅ | ✅ |
| Semantic search (cosine) | ✅ | ✅ |
| Multi-user at scale | ⚠️ | ✅ |

---

## CLI

```bash
npm install -g @the-brain/cli
```

```bash
brain                          # interactive chat
brain process "What do I know about Python?"
brain save "I prefer tabs over spaces" --permanent
brain recall "indentation"
brain ingest ./docs/
brain maintenance
```

Configure via `.env`:
```bash
LLM_API_URL=http://localhost:11434/v1/chat/completions
LLM_MODEL=llama3.2
MONGODB_URI=mongodb://localhost:27017/brain
```

---

## Architecture

```
┌─────────────────────────────────────────┐
│           @the-brain/core               │
│                                         │
│  Intent Router                          │
│  (rules → LLM → confidence → action)   │
│                                         │
│  Memory System                          │
│  (decay, synapses, consolidation)       │
│                                         │
│  Action Registry                        │
│  (dynamic, DB-backed, extensible)       │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
  LLM      Storage    Embedding
 Adapter   Adapter    Adapter
    │          │          │
 Any OpenAI  SQLite /  Any OpenAI
 compatible  MongoDB   compatible
    API                   API
```

---

## License

**AGPL-3.0** — prevents corporate capture. Network copyleft means cloud services built on The Brain must share source.

---

## Author

**Grzegorz Trzaskoma** — Warsaw, Poland

Building privacy-first AI infrastructure. Local LLMs should be competitive with cloud. Users should own their AI.
