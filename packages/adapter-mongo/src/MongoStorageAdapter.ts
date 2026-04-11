import mongoose from "mongoose";
import {
  IStorageAdapter,
  EntryAnalysisData,
  ActionInfo,
} from "@the-brain/core";
import type {
  IVaultEntry,
  TopicAnalysis,
} from "@the-brain/core";
import { VaultEntry, IVaultEntryDoc } from "./models/VaultEntry.js";
import { Synapse } from "./models/Synapse.js";
import { Action } from "./models/Action.js";
import { ChatHistory } from "./models/ChatHistory.js";
import { UserProfile } from "./models/UserProfile.js";
import { BRAIN, MEMORY } from "@the-brain/core";

// ─── Synapse helpers ──────────────────────────────────────────────────────────

const INITIAL_SYNAPSE_WEIGHT = 0.3;
const INITIAL_SYNAPSE_STABILITY = 0.5;
const MAX_SYNAPSES_PER_ENTRY = 3;

async function fireSynapse(
  id1: mongoose.Types.ObjectId | string,
  id2: mongoose.Types.ObjectId | string,
  reason: string = "Manual connection"
): Promise<{ created: boolean }> {
  const fromId = new mongoose.Types.ObjectId(id1);
  const toId = new mongoose.Types.ObjectId(id2);

  const [from, to] = fromId.toString() < toId.toString()
    ? [fromId, toId]
    : [toId, fromId];

  let synapse = await Synapse.findOne({ from, to });
  const isNew = !synapse;

  if (synapse) {
    synapse.weight = Math.min(1.0, synapse.weight + 0.1);
    synapse.lastFired = new Date();
    synapse.reason = reason;
    synapse.stability = Math.min(1.0, synapse.stability + 0.05);
    await synapse.save();
  } else {
    synapse = new Synapse({
      from,
      to,
      weight: INITIAL_SYNAPSE_WEIGHT,
      stability: INITIAL_SYNAPSE_STABILITY,
      lastFired: new Date(),
      reason,
    });
    await synapse.save();
  }

  return { created: isNew };
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class MongoStorageAdapter implements IStorageAdapter {

  // ─── Entry CRUD ───────────────────────────────────────────────────────────

  async createEntry(userId: string, rawText: string, analysis: EntryAnalysisData): Promise<IVaultEntry> {
    const { isPermanent = false, ...analysisData } = analysis;
    const entry = new VaultEntry({ userId, rawText, analysis: analysisData, isPermanent });
    return entry.save() as unknown as IVaultEntry;
  }

  async getEntryById(entryId: string): Promise<IVaultEntry | null> {
    return VaultEntry.findById(entryId) as unknown as IVaultEntry | null;
  }

  // ─── Vault ────────────────────────────────────────────────────────────────

  async getVaultData(userId: string): Promise<{ entries: IVaultEntry[] }> {
    const entries = await VaultEntry.find({ userId }).sort({ createdAt: -1 });
    return { entries: entries as unknown as IVaultEntry[] };
  }

  async deleteVaultEntry(entryId: string, userId: string): Promise<IVaultEntry | null> {
    return VaultEntry.findOneAndDelete({ _id: entryId, userId }) as unknown as IVaultEntry | null;
  }

  // ─── Shared ───────────────────────────────────────────────────────────────

  async getUniqueUserIds(): Promise<string[]> {
    const ids = await VaultEntry.distinct('userId');
    return ids.map((id: unknown) => String(id));
  }

  async getActions(): Promise<ActionInfo[]> {
    const actions = await Action.find({ isActive: true });
    return actions.map(a => ({ name: a.name, description: a.description }));
  }

  async getChatHistory(userId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
    const doc = await ChatHistory.findOne({ userId });
    if (!doc) return [];
    return doc.messages.map(m => ({ role: m.role, content: m.content }));
  }

  async appendChatMessage(userId: string, role: "user" | "assistant", content: string, maxMessages: number): Promise<void> {
    await ChatHistory.findOneAndUpdate(
      { userId },
      {
        $push: { messages: { $each: [{ role, content }], $slice: -maxMessages } },
        $set: { updatedAt: new Date() },
      },
      { upsert: true }
    );
  }

  async getUserProfile(userId: string): Promise<string | null> {
    const doc = await UserProfile.findOne({ userId });
    return doc?.profile ?? null;
  }

  async upsertUserProfile(userId: string, profile: string): Promise<void> {
    await UserProfile.findOneAndUpdate(
      { userId },
      { profile, updatedAt: new Date() },
      { upsert: true }
    );
  }

  async upsertAction(name: string, description: string, isBuiltIn = false): Promise<void> {
    await Action.findOneAndUpdate(
      { name },
      { name, description, isBuiltIn, isActive: true },
      { upsert: true }
    );
  }

  async removeAction(name: string): Promise<void> {
    await Action.deleteOne({ name, isBuiltIn: false });
  }

  // ─── Intent Context ───────────────────────────────────────────────────────

  async findRelevantEntries(userId: string, keywords: string[]): Promise<IVaultEntry[]> {
    const pattern = keywords.join('|');
    return VaultEntry.find({
      userId,
      $or: [
        { 'analysis.summary': { $regex: pattern, $options: 'i' } },
        { rawText: { $regex: pattern, $options: 'i' } },
      ],
    })
      .sort({ 'analysis.strength': -1, lastActivityAt: -1 })
      .limit(MEMORY.CONTEXT_TOP_ENTRIES)
      .lean() as unknown as IVaultEntry[];
  }

  async findSimilarEntries(userId: string, embedding: number[], topK = 3): Promise<IVaultEntry[]> {
    const candidates = await VaultEntry.find({
      userId,
      embedding: { $exists: true, $ne: [] },
    })
      .select('_id rawText analysis embedding')
      .lean() as unknown as (IVaultEntryDoc & { embedding: number[] })[];

    if (candidates.length === 0) return [];

    const scored = candidates.map(entry => ({
      entry,
      score: cosineSimilarity(embedding, entry.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.entry) as unknown as IVaultEntry[];
  }

  async updateEntryEmbedding(entryId: string, embedding: number[]): Promise<void> {
    await VaultEntry.updateOne({ _id: entryId }, { $set: { embedding } });
  }

  // ─── Synapse Queries & Management ────────────────────────────────────────

  async getSynapsesBySource(entryId: string, limit: number): Promise<{
    targetId: string;
    weight: number;
    reason: string;
    targetSummary?: string;
    targetRawText?: string;
  }[]> {
    const synapses = await Synapse.find({ from: new mongoose.Types.ObjectId(entryId) })
      .sort({ weight: -1 })
      .limit(limit)
      .populate('to', 'analysis.summary rawText')
      .lean();

    return synapses.map(synapse => {
      const targetEntry = synapse.to as unknown as {
        _id: { toString(): string };
        analysis?: { summary?: string };
        rawText?: string;
      };
      return {
        targetId: targetEntry._id.toString(),
        weight: synapse.weight,
        reason: synapse.reason || 'semantyczne podobieństwo',
        targetSummary: targetEntry.analysis?.summary,
        targetRawText: targetEntry.rawText,
      };
    });
  }

  async processSynapseLinks(
    synapses: { sourceId: string; targetId: string; reason: string; strength: number }[],
    deltaEntryIds: Set<string>
  ): Promise<number> {
    let createdCount = 0;

    const synapsesBySource = new Map<string, typeof synapses>();
    for (const synapse of synapses) {
      if (!synapsesBySource.has(synapse.sourceId)) {
        synapsesBySource.set(synapse.sourceId, []);
      }
      synapsesBySource.get(synapse.sourceId)!.push(synapse);
    }

    for (const [sourceId, links] of synapsesBySource) {
      if (!deltaEntryIds.has(sourceId)) continue;

      const topLinks = links
        .sort((a, b) => b.strength - a.strength)
        .slice(0, MAX_SYNAPSES_PER_ENTRY);

      console.log(`👁️ [Świadomość]    📎 Wpis ${sourceId.substring(0, 8)}... → ${topLinks.length} synaps (max ${MAX_SYNAPSES_PER_ENTRY})`);

      for (const link of topLinks) {
        try {
          const { created } = await fireSynapse(link.sourceId, link.targetId, link.reason);
          if (created) createdCount++;
        } catch (error) {
          console.error(`👁️ [Świadomość] ❌ Błąd tworzenia synapsy:`, error);
        }
      }
    }

    return createdCount;
  }

  // ─── Conscious Processor ──────────────────────────────────────────────────

  async findDeltaEntries(userId: string, since: Date): Promise<IVaultEntry[]> {
    return VaultEntry.find({
      userId,
      $or: [
        { isAnalyzed: false },
        { lastActivityAt: { $gte: since } },
      ],
    })
      .sort({ lastActivityAt: -1 })
      .limit(MEMORY.DELTA_ENTRIES_LIMIT) as unknown as IVaultEntry[];
  }

  async findContextEntries(userId: string, excludeIds: string[]): Promise<IVaultEntry[]> {
    return VaultEntry.find({
      userId,
      _id: { $nin: excludeIds.map(id => new mongoose.Types.ObjectId(id)) },
      isAnalyzed: true,
      'analysis.strength': { $gte: BRAIN.STRENGTH_CONTEXT_MIN },
    })
      .sort({ 'analysis.strength': -1, lastActivityAt: -1 })
      .limit(MEMORY.CONTEXT_ENTRIES_LIMIT)
      .select('_id rawText analysis') as unknown as IVaultEntry[];
  }

  async applyTopicAnalysis(topic: TopicAnalysis): Promise<number> {
    const ops = topic.entryIds.map(id => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id) },
        update: {
          $set: { isAnalyzed: true },
          $inc: { 'analysis.strength': topic.importance || 1 },
        },
      },
    }));
    if (ops.length === 0) return 0;
    await VaultEntry.bulkWrite(ops);
    return ops.length;
  }

  // ─── Subconscious Routine ─────────────────────────────────────────────────

  async findEntriesToDecay(since: Date): Promise<IVaultEntry[]> {
    return VaultEntry.find({
      isPermanent: { $ne: true },
      lastActivityAt: { $lt: since },
      'analysis.strength': { $gt: 0 },
    }).select('_id analysis.strength') as unknown as IVaultEntry[];
  }

  async decayEntries(entryIds: { toString(): string }[]): Promise<number> {
    if (entryIds.length === 0) return 0;
    const ops = entryIds.map(id => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id.toString()) },
        update: { $inc: { 'analysis.strength': -1 } },
      },
    }));
    const result = await VaultEntry.bulkWrite(ops);
    return result.modifiedCount;
  }

  async pruneDeadEntries(): Promise<number> {
    const result = await VaultEntry.deleteMany({
      'analysis.strength': { $lte: BRAIN.STRENGTH_DECAY_PRUNE },
      isPermanent: { $ne: true },
    });
    return result.deletedCount;
  }

  async pruneDeadSynapses(): Promise<number> {
    const result = await Synapse.deleteMany({
      weight: { $lte: BRAIN.SYNAPSE_PRUNE_WEIGHT },
    });
    return result.deletedCount;
  }

  async countEntries(): Promise<number> {
    return VaultEntry.countDocuments();
  }
}
