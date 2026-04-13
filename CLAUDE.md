# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project

**The Brain** — LLM-agnostic memory framework for AI agents. TypeScript, ESM, monorepo.

Published packages:
- `@the-brain/core` — Brain class, plugin system, memory mechanics, adapters interfaces
- `@the-brain/adapter-sqlite` — SQLite storage (zero-config, Node >= 22.5)
- `@the-brain/adapter-mongo` — MongoDB storage (multi-user, production)
- `@the-brain/cli` — CLI built on core (Commander.js)

Next project being built on the framework: **scheduler** (planned).

---

## Commands

```bash
# In any package directory:
npm test          # vitest run
npm run build     # tsc
npm version patch && npm publish   # prepublishOnly runs build automatically

# Root monorepo:
npm test          # runs all packages
```

---

## Architecture

```
Brain (core)
├── Plugins register Actions via brain.use() / brain.registerAction()
├── brain.process() — classify intent via native tool calling → execute handler
├── brain.run()     — ReAct loop, max N iterations (Reason→Act→Observe)
├── brain.save()    — ingest to VaultEntry (strength=5, isPermanent skips LLM)
├── brain.recall()  — graph traversal + vector similarity → synapticTree
└── brain.runMaintenance()
    ├── subconscious — pure math: decay strength -1, prune entries at 0, prune dead synapses
    └── conscious    — LLM or embedding: find relationships, build synapses (batch=5)
```

**Intent routing:** native OpenAI tool calling API — model must support `tools`. No JSON parsing, no keyword fallback. If `completeWithTools` returns invalid/null → throws.

**Synapse modes** (both must stay, they're a differentiator):
- `synapseMode: "llm"` (default) — LLM finds semantic connections across context, understands life context not just word similarity
- `synapseMode: "embedding"` — cosine similarity, cheaper, deterministic

**Memory lifecycle:** entry strength starts at 5. Subconscious routine: inactive >7 days → strength -1. At 0 → deleted with its synapses. `isPermanent=true` → strength=10, never decays.

---

## Red Lines

**LLM-agnostic — never hard-code a provider:**
```typescript
// ❌ Never:
import OpenAI from 'openai'
// ✅ Always: accept ILLMAdapter, user provides implementation
```

**Zero telemetry.** No analytics, no tracking, no external calls except user-configured LLM/storage.

**AGPL-3.0** — do not suggest changing the license.

**No forced choices.** Framework provides infrastructure. User chooses LLM, storage, plugins.

---

## TypeScript conventions

- ESM throughout (`"type": "module"`)
- Imports use `.js` extension even for `.ts` files: `import { Foo } from "./Foo.js"`
- `strict: true` everywhere
- All packages export types from `src/index.ts`

---

## Current status (April 2026)

**Done:**
- Core framework, plugin system, Brain class
- SQLite + MongoDB adapters (feature parity)
- Native tool calling (`completeWithTools`) + ReAct loop (`brain.run()`)
- CLI (save, recall, process, ingest, maintenance, interactive chat)
- Published to npm, 290 tests passing

**Recommended local LLM:** `qwen2.5:7b` (Ollama) — supports tool calling. `llama3.2` does not.

**Not doing now:** React frontend, MCP server, shell integration, OS features.

---

## Key decisions (don't revisit without reason)

- **No tags/categories** — removed, model generates inconsistently
- **No Long Term Memory model** — removed, synapses replace it
- **No intent fallback** — tool calling is the only routing path, fail loudly
- **isPermanent entries skip LLM analysis** on ingest (strength=10, summary=rawText[:100])
- **Chat history not sent to intent routing** — causes multi-JSON output from small models
- **prepublishOnly runs build** — never publish stale dist
