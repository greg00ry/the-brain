import type { Brain, BrainPlugin } from "../Brain.js";
import { RESEARCH_ANSWER_PROMPT } from "../services/ai/prompts/research-answer.prompt.js";
import { PERSONALITY_SYSTEM_PROMPT } from "../services/ai/prompts/personality.prompt.js";
import { buildSystemPrompt } from "../services/ai/prompts/user-profile.prompt.js";

export class MemoryPlugin implements BrainPlugin {
  private readonly description: string;
  private readonly systemPrompt: string;

  constructor(options?: { description?: string; systemPrompt?: string }) {
    this.description = options?.description
      ?? "user explicitly asks a question about past notes, memory, or stored knowledge";
    this.systemPrompt = options?.systemPrompt ?? PERSONALITY_SYSTEM_PROMPT;
  }

  async register(brain: Brain): Promise<void> {
    const systemPrompt = this.systemPrompt;
    await brain.registerAction(
      "RESEARCH_BRAIN",
      this.description,
      async (userId, text, { relevantEntries, hasContext }, _llm, chatHistory) => {
        const userProfile = await brain.storage.getUserProfile(userId);
        const sysPrompt = buildSystemPrompt(systemPrompt, userProfile);
        const maxChars = brain.cfg.memory.contextMaxCharsPerEntry;
        const fullContext = relevantEntries
          .map((e, i) => `[${i + 1}] ${e.rawText.substring(0, maxChars)}`)
          .join('\n\n---\n\n');
        const prompt = hasContext
          ? RESEARCH_ANSWER_PROMPT(text, fullContext, chatHistory)
          : `The user asked: "${text}"\n\nYou don't have anything stored about this yet. Let them know and ask if they want to tell you more.`;
        const answer = await brain.llm.complete({
          systemPrompt: sysPrompt,
          userPrompt: prompt,
          temperature: brain.cfg.llm.responseTemperature,
          maxTokens: brain.cfg.llm.responseMaxTokens,
        });
        return answer ?? "Coś poszło nie tak z generowaniem odpowiedzi.";
      },
    );
  }
}
