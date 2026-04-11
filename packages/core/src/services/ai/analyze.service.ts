import { ILLMAdapter } from "../../adapters/ILLMAdapter.js";
import { cleanAndParseJSON } from "../../utils/json.js";
import { ANALYZE_PROMPT } from "./prompts/analyze.prompt.js";
import { LLM } from "../../config/constants.js";

export interface AIAnalysis {
  summary: string;
  strength: number;
  isProcessed: boolean;
}

const SUMMARY_MAX_LENGTH = 100;

const truncate = (text: string): string =>
  text.length > SUMMARY_MAX_LENGTH ? text.substring(0, SUMMARY_MAX_LENGTH) + '...' : text;

const FALLBACK_ANALYSIS = (text: string): AIAnalysis => ({
  summary: truncate(text),
  strength: 5,
  isProcessed: false,
});

export const analyzeTextWithAI = async (text: string, llm: ILLMAdapter): Promise<AIAnalysis> => {
  try {
    const content = await llm.complete({
      systemPrompt: 'You are a technical assistant that analyzes text and returns structured JSON data. Always respond with valid JSON only.',
      userPrompt: ANALYZE_PROMPT(text),
      temperature: LLM.TEXT_ANALYZE_TEMPERATURE,
      maxTokens: LLM.TEXT_ANALYZE_MAX_TOKENS,
    });

    if (!content) {
      console.error('Failed to get AI response');
      return FALLBACK_ANALYSIS(text);
    }

    const parsed = cleanAndParseJSON(content);
    if (!parsed) {
      console.error('Failed to parse AI response:', content);
      return FALLBACK_ANALYSIS(text);
    }

    return {
      summary: parsed.summary || truncate(text),
      strength: Number(parsed.strength) || 0,
      isProcessed: true,
    };
  } catch (err) {
    console.error('[Analyze] LLM error (non-fatal):', err instanceof Error ? err.message : String(err));
    return FALLBACK_ANALYSIS(text);
  }
};
