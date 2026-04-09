import { ILLMAdapter } from "./adapters/ILLMAdapter.js";
import { IStorageAdapter, ActionInfo } from "./adapters/IStorageAdapter.js";
import { IEmbeddingAdapter } from "./adapters/IEmbeddingAdapter.js";
import { classifyIntent, ChatMessage } from "./services/ai/intent.service.js";
import { getBrainContext } from "./services/ai/intent.context.service.js";
import { proccessAndStore } from "./services/ingest/ingest.service.js";
import { runSubconsciousRoutine } from "./services/brain/subconscious.routine.js";
import { runConsciousProcessor } from "./services/brain/conscious.processor.js";
import { RESEARCH_ANSWER_PROMPT } from "./services/ai/prompts/research-answer.prompt.js";
import { SAVE_RESPONSE_PROMPT } from "./services/ai/prompts/save-response.prompt.js";
import { PERSONALITY_SYSTEM_PROMPT } from "./services/ai/prompts/personality.prompt.js";
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
    decayWindowMs?: number;
  };
  chat?: {
    historyMaxStored?: number;
    maintenanceEveryN?: number;
    profileUpdateEveryN?: number;
  };
}

export type ActionHandler = (
  userId: string,
  text: string,
  context: { synapticTree: string; hasContext: boolean },
  llm: ILLMAdapter,
  chatHistory?: { role: string; content: string }[],
) => Promise<string>;

export interface ProcessResult {
  action: string;
  answer: string;
  entryId?: unknown;
}

// ─── Built-in handlers ────────────────────────────────────────────────────────

const BUILT_IN_ACTIONS: { name: string; description: string }[] = [
  { name: "SAVE_ONLY", description: "user states a fact, shares info, opinion, preference, or wants to store something" },
  { name: "RESEARCH_BRAIN", description: "user explicitly asks a question about past notes, memory, or stored knowledge" },
];

export class Brain {
  private actionsCache: ActionInfo[] = [];
  private handlers = new Map<string, ActionHandler>();
  private saveCount = 0;
  private conversationCount = 0;
  private readonly cfg: Required<{
    llm: Required<NonNullable<BrainConfig["llm"]>>;
    memory: Required<NonNullable<BrainConfig["memory"]>>;
    chat: Required<NonNullable<BrainConfig["chat"]>>;
  }>;

  constructor(
    private readonly llm: ILLMAdapter,
    private readonly storage: IStorageAdapter,
    private readonly embedding?: IEmbeddingAdapter,
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
        decayWindowMs: config?.memory?.decayWindowMs ?? BRAIN.DECAY_WINDOW_MS,
      },
      chat: {
        historyMaxStored: config?.chat?.historyMaxStored ?? CHAT.HISTORY_MAX_STORED,
        maintenanceEveryN: config?.chat?.maintenanceEveryN ?? CHAT.MAINTENANCE_EVERY_N,
        profileUpdateEveryN: config?.chat?.profileUpdateEveryN ?? CHAT.PROFILE_UPDATE_EVERY_N,
      },
    };
    const basePersonality = config?.systemPrompt ?? PERSONALITY_SYSTEM_PROMPT;

    this.handlers.set("RESEARCH_BRAIN", async (userId, text, { synapticTree, hasContext }, _llm, chatHistory) => {
      const userProfile = await this.storage.getUserProfile(userId);
      const systemPrompt = buildSystemPrompt(basePersonality, userProfile);

      const prompt = hasContext
        ? RESEARCH_ANSWER_PROMPT(text, synapticTree, chatHistory)
        : `The user asked: "${text}"\n\nYou don't have anything stored about this yet. Let them know and ask if they want to tell you more.`;

      const answer = await this.llm.complete({
        systemPrompt,
        userPrompt: prompt,
        temperature: this.cfg.llm.responseTemperature,
        maxTokens: this.cfg.llm.responseMaxTokens,
      });
      return answer ?? "Coś poszło nie tak z generowaniem odpowiedzi.";
    });

    this.handlers.set("SAVE_ONLY", async (userId, text, _context, _llm, chatHistory) => {
      const userProfile = await this.storage.getUserProfile(userId);
      const systemPrompt = buildSystemPrompt(basePersonality, userProfile);

      const answer = await this.llm.complete({
        systemPrompt,
        userPrompt: SAVE_RESPONSE_PROMPT(text, chatHistory),
        temperature: this.cfg.llm.saveTemperature,
        maxTokens: this.cfg.llm.saveMaxTokens,
      });
      return answer ?? "Zapisałem to.";
    });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async loadActions(): Promise<void> {
    // Seed built-in actions if not present
    for (const action of BUILT_IN_ACTIONS) {
      await this.storage.upsertAction(action.name, action.description, true);
    }
    this.actionsCache = await this.storage.getActions();
  }

  async registerAction(name: string, description: string, handler: ActionHandler): Promise<void> {
    await this.storage.upsertAction(name, description, false);
    this.actionsCache = await this.storage.getActions();
    this.handlers.set(name, handler);
  }

  async removeAction(name: string): Promise<void> {
    await this.storage.removeAction(name);
    this.actionsCache = await this.storage.getActions();
    this.handlers.delete(name);
  }

  // ─── Process ──────────────────────────────────────────────────────────────

  async process(userId: string, text: string): Promise<ProcessResult> {
    const actions = this.actionsCache.length > 0 ? this.actionsCache : BUILT_IN_ACTIONS;

    // Load persistent chat history from DB
    const chatHistory = await this.storage.getChatHistory(userId);

    const intent = await classifyIntent({ userText: text, chatHistory, actions }, this.llm);

    const context = await getBrainContext(userId, text, this.storage, this.embedding, this.cfg.memory);

    const handler = this.handlers.get(intent.action);
    if (!handler) {
      return { action: intent.action, answer: `Nieznana akcja: ${intent.action}` };
    }

    let answer: string;

    if (intent.action === "SAVE_ONLY") {
      const entry = await proccessAndStore(userId, text, this.llm, this.storage, this.embedding);
      answer = await handler(userId, text, context, this.llm, chatHistory);

      // Trigger maintenance every N saves (fire and forget)
      this.saveCount++;
      if (this.saveCount % this.cfg.chat.maintenanceEveryN === 0) {
        this.runMaintenance().catch(err => console.error('[Brain] Maintenance error:', err));
      }

      // Persist chat history
      await this.storage.appendChatMessage(userId, "user", text, this.cfg.chat.historyMaxStored);
      await this.storage.appendChatMessage(userId, "assistant", answer, this.cfg.chat.historyMaxStored);

      // Update user profile every N conversations (fire and forget)
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

    // Update user profile every N conversations (fire and forget)
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
    const consciousStats = await runConsciousProcessor(this.llm, this.storage);
    return { subStats, consciousStats };
  }
}
