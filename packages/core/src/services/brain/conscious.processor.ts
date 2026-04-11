import { IVaultEntry } from "../../types/brain.js";
import { ILLMAdapter } from "../../adapters/ILLMAdapter.js";
import { IEmbeddingAdapter } from "../../adapters/IEmbeddingAdapter.js";
import { cleanAndParseJSON } from "../../utils/json.js";
import { IStorageAdapter } from "../../adapters/IStorageAdapter.js";
import { TopicAnalysis } from "../../types/brain.js";
import { ANALYZE_WITH_SYNAPSES_PROMPT } from "../ai/prompts/analyze-with-synapses.prompt.js";
import { BRAIN, LLM, MEMORY } from "../../config/constants.js";

// ============================================================================
// CONSCIOUS PROCESSOR - AI-DRIVEN, DELTA ONLY
// ============================================================================

interface SynapseLink {
  sourceId: string;
  targetId: string;
  reason: string;
  strength: number;
}

interface AnalysisResult {
  topics: TopicAnalysis[];
  synapses: SynapseLink[];
}

export interface ConsciousStats {
  analyzed: number;
  synapsesCreated: number;
}

// ─── Embedding-based synapse creation ────────────────────────────────────────

async function buildSynapsesFromEmbeddings(
  entry: IVaultEntry,
  storage: IStorageAdapter,
  embedding: IEmbeddingAdapter,
): Promise<SynapseLink[]> {
  const vector = entry.embedding ?? await embedding.embed(entry.rawText);

  const similar = await storage.findSimilarEntries(entry.userId, vector, MEMORY.SYNAPSE_BRANCH_FACTOR + 1);

  return similar
    .filter(e => e._id.toString() !== entry._id.toString())
    .slice(0, MEMORY.SYNAPSE_BRANCH_FACTOR)
    .map(e => ({
      sourceId: entry._id.toString(),
      targetId: e._id.toString(),
      reason: "semantic similarity",
      strength: 7, // fixed — cosine similarity not exposed from findSimilarEntries
    }));
}

// ─── LLM-based synapse creation (fallback) ───────────────────────────────────

async function analyzeWithSynapses(
  deltaEntries: IVaultEntry[],
  contextEntries: IVaultEntry[],
  llm: ILLMAdapter
): Promise<AnalysisResult> {
  if (deltaEntries.length === 0) return { topics: [], synapses: [] };

  const deltaSummaries = deltaEntries.map(e => ({
    id: e._id.toString(),
    text: e.analysis?.summary || e.rawText.substring(0, 150),
    isNew: true,
  }));

  const contextSummaries = contextEntries.map(e => ({
    id: e._id.toString(),
    text: e.analysis?.summary || e.rawText.substring(0, 100),
    isNew: false,
  }));

  const prompt = ANALYZE_WITH_SYNAPSES_PROMPT(
    JSON.stringify(deltaSummaries, null, 1),
    JSON.stringify(contextSummaries, null, 1)
  );

  try {
    console.log('👁️ [Świadomość]    Wysyłam do AI:', deltaEntries.length, 'nowych +', contextEntries.length, 'kontekstowych');

    const content = await llm.complete({
      systemPrompt: "You analyze entries and find semantic connections. Return ONLY valid JSON with topics and synapses arrays. Be selective with connections - only meaningful ones.",
      userPrompt: prompt,
      temperature: LLM.ANALYSIS_TEMPERATURE,
      maxTokens: LLM.ANALYSIS_MAX_TOKENS,
    });

    if (!content) {
      console.error('👁️ [Świadomość] ⚠️ LLM niedostępne');
      return { topics: [], synapses: [] };
    }

    return cleanAndParseJSON(content) || { topics: [], synapses: [] };

  } catch (error) {
    console.error('👁️ [Świadomość] ❌ Błąd analizy:', error);
    return { topics: [], synapses: [] };
  }
}

// ─── Main processor ──────────────────────────────────────────────────────────

export async function runConsciousProcessor(
  llm: ILLMAdapter,
  storage: IStorageAdapter,
  embedding?: IEmbeddingAdapter,
): Promise<ConsciousStats> {
  const mode = embedding ? "embedding" : "llm";
  console.log(`\n👁️ [Świadomość] Uruchamiam świadomy procesor... (tryb: ${mode})`);
  const startTime = Date.now();

  const stats: ConsciousStats = {
    analyzed: 0,
    synapsesCreated: 0,
  };

  try {
    const userIds = await storage.getUniqueUserIds();
    console.log(`👁️ [Świadomość] Przetwarzam ${userIds.length} użytkowników`);

    for (const userId of userIds) {
      console.log(`\n👁️ [Świadomość] 👤 Użytkownik: ${userId.substring(0, 8)}...`);

      const since = new Date(Date.now() - BRAIN.DELTA_WINDOW_MS);
      const deltaEntries = await storage.findDeltaEntries(userId, since);

      if (deltaEntries.length === 0) {
        console.log('👁️ [Świadomość]    Brak nowych wpisów do analizy');
        continue;
      }

      console.log(`👁️ [Świadomość]    Delta: ${deltaEntries.length} wpisów do analizy`);

      if (embedding) {
        // ── Embedding mode ──────────────────────────────────────────────────
        for (const entry of deltaEntries) {
          const synapses = await buildSynapsesFromEmbeddings(entry, storage, embedding);

          if (synapses.length > 0) {
            const deltaIdSet = new Set([entry._id.toString()]);
            const created = await storage.processSynapseLinks(synapses, deltaIdSet);
            stats.synapsesCreated += created;
          }
        }

        await storage.markEntriesAnalyzed(deltaEntries.map(e => e._id.toString()));
        stats.analyzed += deltaEntries.length;

      } else {
        // ── LLM mode (fallback) ─────────────────────────────────────────────
        for (let i = 0; i < deltaEntries.length; i += BRAIN.BATCH_SIZE) {
          const currentBatch = deltaEntries.slice(i, i + BRAIN.BATCH_SIZE);
          console.log(`🧠 [Batch] Przetwarzam paczkę ${Math.floor(i / BRAIN.BATCH_SIZE) + 1} (${currentBatch.length} wpisów)...`);

          const deltaIds = currentBatch.map(e => e._id.toString());
          const contextEntries = await storage.findContextEntries(userId, deltaIds);

          const { topics, synapses } = await analyzeWithSynapses(currentBatch, contextEntries, llm);
          console.log(`👁️ [Batch] Zidentyfikowano ${topics.length} tematów, ${synapses.length} połączeń`);

          for (const topic of topics) {
            const count = await storage.applyTopicAnalysis(topic);
            stats.analyzed += count;
          }

          if (synapses.length > 0) {
            const deltaIdSet = new Set(deltaIds);
            const synapsesCreated = await storage.processSynapseLinks(synapses, deltaIdSet);
            stats.synapsesCreated += synapsesCreated;
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n👁️ [Świadomość] ✅ Zakończono w ${duration}s`);
    console.log(`👁️ [Świadomość] 📊 Statystyki:`);
    console.log(`   - Przeanalizowane: ${stats.analyzed}`);
    console.log(`   - Utworzone synapsy: ${stats.synapsesCreated}`);

  } catch (error) {
    console.error('👁️ [Świadomość] ❌ Błąd:', error);
  }

  return stats;
}
