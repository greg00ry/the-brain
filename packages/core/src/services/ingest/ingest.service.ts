import { analyzeTextWithAI } from "../ai/analyze.service.js";
import { ILLMAdapter } from "../../adapters/ILLMAdapter.js";
import { IStorageAdapter } from "../../adapters/IStorageAdapter.js";
import { IEmbeddingAdapter } from "../../adapters/IEmbeddingAdapter.js";

export const proccessAndStore = async (
  userId: string,
  text: string,
  llm: ILLMAdapter,
  storage: IStorageAdapter,
  embedding?: IEmbeddingAdapter,
  isPermanent = false,
) => {
  const analysis = isPermanent
    ? { summary: text.substring(0, 100), strength: 10, isProcessed: true }
    : await analyzeTextWithAI(text, llm);
  const entry = await storage.createEntry(userId, text, { ...analysis, isPermanent });

  if (embedding) {
    try {
      const vector = await embedding.embed(text);
      await storage.updateEntryEmbedding(entry._id.toString(), vector);
    } catch (err) {
      console.warn('[Ingest] Embedding generation failed (non-fatal):', err);
    }
  }

  return entry;
};
