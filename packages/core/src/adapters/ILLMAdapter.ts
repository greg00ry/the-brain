// ═══════════════════════════════════════════════════════════════════════════════
// LLM ADAPTER INTERFACE - Framework-agnostic LLM abstraction
// ═══════════════════════════════════════════════════════════════════════════════

export interface LLMRequest {
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
  };
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Adapter interface for any LLM backend.
 * Returns the raw text content from the model, or null on failure.
 * Callers use cleanAndParseJSON() if they need structured output.
 *
 * completeWithTools() is optional — implement it to enable native tool calling.
 * When absent, Brain falls back to classifyIntent() prompt-based routing.
 */
export interface ILLMAdapter {
  complete(request: LLMRequest): Promise<string | null>;
  completeWithTools?(request: LLMRequest, tools: LLMTool[]): Promise<LLMToolCall | null>;
}
