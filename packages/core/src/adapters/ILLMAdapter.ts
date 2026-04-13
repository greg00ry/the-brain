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
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface LLMToolResponse {
  toolCall?: LLMToolCall;
  text?: string;
}

/**
 * Adapter interface for any LLM backend.
 * Returns the raw text content from the model, or null on failure.
 *
 * completeWithTools() accepts a full message array (for ReAct loop support)
 * and returns either a tool call or a final text response.
 */
export interface ILLMAdapter {
  complete(request: LLMRequest): Promise<string | null>;
  completeWithTools?(messages: LLMMessage[], tools: LLMTool[], systemPrompt?: string): Promise<LLMToolResponse | null>;
}
