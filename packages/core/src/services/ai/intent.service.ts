import { IntentResult } from "./intent.types.js";
import { ILLMAdapter } from "../../adapters/ILLMAdapter.js";
import { IEmbeddingAdapter } from "../../adapters/IEmbeddingAdapter.js";
import { IStorageAdapter, ActionInfo } from "../../adapters/IStorageAdapter.js";
import { cleanAndParseJSON } from "../../utils/json.js";
import { matchRules } from "./rule-engine.js";
import { LLM, ROUTING } from "../../config/constants.js";

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ClassifyIntentParams {
  userText: string;
  chatHistory?: ChatMessage[];
  actions: ActionInfo[];
  storage?: IStorageAdapter;
  embeddingAdapter?: IEmbeddingAdapter;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(userText: string, actions: ActionInfo[], chatHistory?: ChatMessage[]): string {
  let history = '';
  if (chatHistory && chatHistory.length > 0) {
    history = '\nCONVERSATION:\n';
    chatHistory.slice(-3).forEach(msg => {
      history += `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}\n`;
    });
  }

  const actionList = actions
    .map(a => `- "${a.name}": ${a.description}`)
    .join('\n');

  return `### ROLE
You are a deterministic routing engine. Return ONLY JSON.

### ACTIONS
${actionList}

### JSON STRUCTURE
{
  "action": "<one of the action names above>",
  "confidence": <integer 0-100>,
  "reasoning": "one short sentence"
}${history}

USER: ${userText}`;
}

// ─── JSON Parser ──────────────────────────────────────────────────────────────

function parseIntentJSON(raw: string, validActions: Set<string>): IntentResult | null {
  const parsed = cleanAndParseJSON(raw);
  if (!parsed) return null;

  const action = parsed["action"];
  if (typeof action !== "string" || !validActions.has(action)) return null;

  const confidence = typeof parsed["confidence"] === "number"
    ? Math.min(100, Math.max(0, parsed["confidence"]))
    : 50;

  return {
    action,
    reasoning: parsed["reasoning"] || "no reason",
    confidence,
    source: "llm",
  };
}

// ─── Hybrid Routing ───────────────────────────────────────────────────────────

export async function classifyIntent(
  params: ClassifyIntentParams,
  llm: ILLMAdapter,
): Promise<IntentResult> {
  const { userText, chatHistory = [], actions, storage, embeddingAdapter } = params;
  const validActions = new Set(actions.map(a => a.name));
  const defaultAction = actions[0]?.name ?? "SAVE_ONLY";

  // Step 1: Rule engine — high confidence rules skip LLM entirely
  const ruleMatch = matchRules(userText);
  if (ruleMatch && ruleMatch.confidence >= ROUTING.RULE_HIGH_CONFIDENCE && validActions.has(ruleMatch.action)) {
    return {
      action: ruleMatch.action,
      reasoning: ruleMatch.reasoning,
      confidence: ruleMatch.confidence,
      source: "rule",
    };
  }

  // Step 2: Intent points (embedding-based) — skips LLM when similarity is high
  if (storage && embeddingAdapter) {
    try {
      const queryEmbedding = await embeddingAdapter.embed(userText);
      const nearest = await storage.findNearestIntentAction(queryEmbedding, 1);
      const top = nearest[0];
      if (top && top.similarity >= ROUTING.INTENT_POINTS_MIN_SIMILARITY && validActions.has(top.actionName)) {
        return {
          action: top.actionName,
          reasoning: `Intent points match (similarity: ${top.similarity.toFixed(3)})`,
          confidence: Math.round(top.similarity * 100),
          source: "rule",
        };
      }
    } catch (err) {
      console.error(`[IntentService] Intent points error:`, err instanceof Error ? err.message : String(err));
    }
  }

  // Step 3: LLM classification
  try {
    const prompt = buildPrompt(userText, actions, chatHistory);

    const rawContent = await llm.complete({
      userPrompt: prompt,
      temperature: LLM.INTENT_TEMPERATURE,
      maxTokens: LLM.INTENT_MAX_TOKENS,
    });

    const llmResult = rawContent ? parseIntentJSON(rawContent, validActions) : null;

    // Step 3: LLM confidence high enough — trust it
    if (llmResult && llmResult.confidence >= ROUTING.LLM_MIN_CONFIDENCE) {
      // Structural routing: if LLM classified a question as SAVE_ONLY, redirect to RESEARCH_BRAIN.
      // Custom actions (e.g. TRADING_SIGNAL) are preserved — only SAVE_ONLY is overridden.
      if (llmResult.action === "SAVE_ONLY" && /\?/.test(userText) && validActions.has("RESEARCH_BRAIN")) {
        return {
          action: "RESEARCH_BRAIN",
          reasoning: "Structural routing: question redirected from SAVE_ONLY",
          confidence: 88,
          source: "rule",
        };
      }
      return llmResult;
    }

    // Step 4: LLM uncertain — prefer rule match
    if (ruleMatch && validActions.has(ruleMatch.action)) {
      return {
        action: ruleMatch.action,
        reasoning: `Rule fallback (LLM confidence: ${llmResult?.confidence ?? 0}): ${ruleMatch.reasoning}`,
        confidence: ruleMatch.confidence,
        source: "rule",
      };
    }

    // Step 5: Take LLM result even if low confidence
    // Structural routing applies here too: question + SAVE_ONLY → RESEARCH_BRAIN
    if (llmResult) {
      if (llmResult.action === "SAVE_ONLY" && /\?/.test(userText) && validActions.has("RESEARCH_BRAIN")) {
        return {
          action: "RESEARCH_BRAIN",
          reasoning: "Structural routing: question redirected from SAVE_ONLY",
          confidence: 88,
          source: "rule",
        };
      }
      return llmResult;
    }

  } catch (err) {
    console.error(`[IntentService] Error:`, err instanceof Error ? err.message : String(err));
  }

  // Step 6: Default fallback
  return {
    action: defaultAction,
    reasoning: "Fallback",
    confidence: 0,
    source: "fallback",
  };
}
