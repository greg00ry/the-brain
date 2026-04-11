import type { Brain, BrainPlugin } from "../Brain.js";
import { SAVE_RESPONSE_PROMPT } from "../services/ai/prompts/save-response.prompt.js";
import { PERSONALITY_SYSTEM_PROMPT } from "../services/ai/prompts/personality.prompt.js";
import { buildSystemPrompt } from "../services/ai/prompts/user-profile.prompt.js";

export class SavingPlugin implements BrainPlugin {
  private readonly description: string;
  private readonly systemPrompt: string;

  constructor(options?: { description?: string; systemPrompt?: string }) {
    this.description = options?.description
      ?? "user states a fact, shares info, opinion, preference, or wants to store something";
    this.systemPrompt = options?.systemPrompt ?? PERSONALITY_SYSTEM_PROMPT;
  }

  async register(brain: Brain): Promise<void> {
    const systemPrompt = this.systemPrompt;
    await brain.registerAction(
      "SAVE_ONLY",
      this.description,
      async (userId, text, _context, _llm, chatHistory) => {
        const userProfile = await brain.storage.getUserProfile(userId);
        const sysPrompt = buildSystemPrompt(systemPrompt, userProfile);
        const answer = await brain.llm.complete({
          systemPrompt: sysPrompt,
          userPrompt: SAVE_RESPONSE_PROMPT(text, chatHistory),
          temperature: brain.cfg.llm.saveTemperature,
          maxTokens: brain.cfg.llm.saveMaxTokens,
        });
        return answer ?? "Zapisałem to.";
      },
    );
  }
}
