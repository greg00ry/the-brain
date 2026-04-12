import { ILLMAdapter } from "./adapters/ILLMAdapter.js";
import { IVaultEntry } from "./types/brain.js";
import { IStorageAdapter, ActionInfo } from "./adapters/IStorageAdapter.js";
import { IEmbeddingAdapter } from "./adapters/IEmbeddingAdapter.js";
import { classifyIntent, ChatMessage } from "./services/ai/intent.service.js";
import { getBrainContext } from "./services/ai/intent.context.service.js";
import { proccessAndStore } from "./services/ingest/ingest.service.js";
import { runSubconsciousRoutine } from "./services/brain/subconscious.routine.js";
import { runConsciousProcessor } from "./services/brain/conscious.processor.js";
import { USER_PROFILE_PROMPT, buildSystemPrompt } from "./services/ai/prompts/user-profile.prompt.js";
import { LLM, CHAT, MEMORY, BRAIN } from "./config/constants.js";

export interface BrainConfig {
  systemPrompt?: string;
  llm?: {
    responseTemperature?: number;
    responseMaxTokens?: number;
    saveTemperature?: number;
    saveMaxTokens?: number;
  };
  memory?: {
    synapseTreeDepth?: number;
    synapseBranchFactor?: number;
    contextTopEntries?: number;
    contextMaxCharsPerEntry?: number;
    decayWindowMs?: number;
    synapseMode?: "embedding" | "llm"; // default: "llm"
  };
  chat?: {
    historyMaxStored?: number;
    maintenanceEveryN?: number;
    profileUpdateEveryN?: number;
  };
}

export interface BrainPlugin {
  register(brain: Brain): Promise<void>;
}

export type ActionHandler = (
  userId: string,
  text: string,
  context: { synapticTree: string; relevantEntries: IVaultEntry[]; hasContext: boolean },
  llm: ILLMAdapter,
  chatHistory?: { role: string; content: string }[],
) => Promise<string>;

export interface ProcessResult {
  action: string;
  answer: string;
  entryId?: unknown;
}

export class Brain {
  private actionsCache: ActionInfo[] = [];
  private readonly handlers = new Map<string, ActionHandler>();
  private saveCount = 0;
  private conversationCount = 0;

  readonly cfg: Required<{
    llm: Required<NonNullable<BrainConfig["llm"]>>;
    memory: Required<NonNullable<BrainConfig["memory"]>>;
    chat: Required<NonNullable<BrainConfig["chat"]>>;
  }>;

  constructor(
    public readonly llm: ILLMAdapter,
    public readonly storage: IStorageAdapter,
    public readonly embedding?: IEmbeddingAdapter,
    config?: BrainConfig,
  ) {
    this.cfg = {
      llm: {
        responseTemperature: config?.llm?.responseTemperature ?? LLM.RESPONSE_TEMPERATURE,
        responseMaxTokens: config?.llm?.responseMaxTokens ?? LLM.RESPONSE_MAX_TOKENS,
        saveTemperature: config?.llm?.saveTemperature ?? LLM.SAVE_TEMPERATURE,
        saveMaxTokens: config?.llm?.saveMaxTokens ?? LLM.SAVE_MAX_TOKENS,
      },
      memory: {
        synapseTreeDepth: config?.memory?.synapseTreeDepth ?? MEMORY.SYNAPSE_TREE_DEPTH,
        synapseBranchFactor: config?.memory?.synapseBranchFactor ?? MEMORY.SYNAPSE_BRANCH_FACTOR,
        contextTopEntries: config?.memory?.contextTopEntries ?? MEMORY.CONTEXT_TOP_ENTRIES,
        contextMaxCharsPerEntry: config?.memory?.contextMaxCharsPerEntry ?? MEMORY.CONTEXT_MAX_CHARS_PER_ENTRY,
        decayWindowMs: config?.memory?.decayWindowMs ?? BRAIN.DECAY_WINDOW_MS,
        synapseMode: config?.memory?.synapseMode ?? "llm",
      },
      chat: {
        historyMaxStored: config?.chat?.historyMaxStored ?? CHAT.HISTORY_MAX_STORED,
        maintenanceEveryN: config?.chat?.maintenanceEveryN ?? CHAT.MAINTENANCE_EVERY_N,
        profileUpdateEveryN: config?.chat?.profileUpdateEveryN ?? CHAT.PROFILE_UPDATE_EVERY_N,
      },
    };
  }

  // ─── Plugins ──────────────────────────────────────────────────────────────

  async use(...plugins: BrainPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      await plugin.register(this);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async loadActions(): Promise<void> {
    this.actionsCache = await this.storage.getActions();
  }

  async registerAction(name: string, description: string, handler: ActionHandler, examples?: string[]): Promise<void> {
    await this.storage.upsertAction(name, description, false);
    this.actionsCache = await this.storage.getActions();
    this.handlers.set(name, handler);

    if (examples && examples.length > 0 && this.embedding) {
      const embeddings = await Promise.all(examples.map(e => this.embedding!.embed(e)));
      await this.storage.upsertIntentPoints(name, embeddings);
    }
  }

  async removeAction(name: string): Promise<void> {
    await this.storage.removeAction(name);
    this.actionsCache = await this.storage.getActions();
    this.handlers.delete(name);
  }

  async addIntentExamples(actionName: string, examples: string[]): Promise<void> {
    if (!this.embedding) {
      console.warn(`[Brain] addIntentExamples: no embedding adapter — skipping intent points for "${actionName}"`);
      return;
    }
    const embeddings = await Promise.all(examples.map(e => this.embedding!.embed(e)));
    await this.storage.upsertIntentPoints(actionName, embeddings);
  }

  // ─── Process ──────────────────────────────────────────────────────────────

  async process(userId: string, text: string): Promise<ProcessResult> {
    const actions = this.actionsCache;

    const chatHistory = await this.storage.getChatHistory(userId);
    const intent = await classifyIntent({ userText: text, chatHistory, actions, storage: this.storage, embeddingAdapter: this.embedding }, this.llm);
    const context = await getBrainContext(userId, text, this.storage, this.embedding, this.cfg.memory);

    const handler = this.handlers.get(intent.action);
    if (!handler) {
      return { action: intent.action, answer: `Nieznana akcja: ${intent.action}` };
    }

    let answer: string;

    if (intent.action === "SAVE_ONLY") {
      const entry = await proccessAndStore(userId, text, this.llm, this.storage, this.embedding);
      answer = await handler(userId, text, context, this.llm, chatHistory);

      this.saveCount++;
      if (this.saveCount % this.cfg.chat.maintenanceEveryN === 0) {
        this.runMaintenance().catch(err => console.error('[Brain] Maintenance error:', err));
      }

      await this.storage.appendChatMessage(userId, "user", text, this.cfg.chat.historyMaxStored);
      await this.storage.appendChatMessage(userId, "assistant", answer, this.cfg.chat.historyMaxStored);

      this.conversationCount++;
      if (this.conversationCount % this.cfg.chat.profileUpdateEveryN === 0) {
        this.updateUserProfile(userId, chatHistory).catch(err =>
          console.error('[Brain] Profile update error:', err)
        );
      }

      return { action: "SAVE_ONLY", answer, entryId: entry._id };
    }

    answer = await handler(userId, text, context, this.llm, chatHistory);

    await this.storage.appendChatMessage(userId, "user", text, this.cfg.chat.historyMaxStored);
    await this.storage.appendChatMessage(userId, "assistant", answer, this.cfg.chat.historyMaxStored);

    this.conversationCount++;
    if (this.conversationCount % this.cfg.chat.profileUpdateEveryN === 0) {
      this.updateUserProfile(userId, chatHistory).catch(err =>
        console.error('[Brain] Profile update error:', err)
      );
    }

    return { action: intent.action, answer };
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  private async updateUserProfile(userId: string, chatHistory: { role: string; content: string }[]): Promise<void> {
    if (chatHistory.length === 0) return;

    const sample = chatHistory
      .slice(-CHAT.HISTORY_MAX_STORED)
      .map(m => `${m.role === 'user' ? 'User' : 'Brain'}: ${m.content}`)
      .join('\n');

    const existingProfile = await this.storage.getUserProfile(userId);
    const prompt = USER_PROFILE_PROMPT(sample, existingProfile);

    const profile = await this.llm.complete({
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 300,
    });

    if (profile) {
      await this.storage.upsertUserProfile(userId, profile);
    }
  }

  async recall(userId: string, text: string) {
    return getBrainContext(userId, text, this.storage, this.embedding, this.cfg.memory);
  }

  async save(userId: string, text: string, isPermanent = false) {
    return proccessAndStore(userId, text, this.llm, this.storage, this.embedding, isPermanent);
  }

  async runMaintenance() {
    const subStats = await runSubconsciousRoutine(this.storage, this.cfg.memory.decayWindowMs);
    const embeddingForSynapses = this.cfg.memory.synapseMode === "embedding" ? this.embedding : undefined;
    const consciousStats = await runConsciousProcessor(this.llm, this.storage, embeddingForSynapses);
    return { subStats, consciousStats };
  }
}
