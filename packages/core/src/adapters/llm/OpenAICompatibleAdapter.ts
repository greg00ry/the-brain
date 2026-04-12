import { ILLMAdapter, LLMRequest, LLMTool, LLMToolCall } from "../ILLMAdapter.js";
import { LLM } from "../../config/constants.js";

// Works with any OpenAI-compatible API: LM Studio, Ollama, OpenAI, etc.
export class OpenAICompatibleAdapter implements ILLMAdapter {
  constructor(
    private readonly url: string = LLM.API_URL,
    private readonly model: string = LLM.MODEL,
    private readonly apiKey: string = "local",
    private readonly timeout: number = LLM.TIMEOUT,
  ) {}

  private buildMessages(request: LLMRequest) {
    return [
      ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
      { role: "user", content: request.userPrompt },
    ];
  }

  private async post(body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(request: LLMRequest): Promise<string | null> {
    const data = await this.post({
      model: this.model,
      messages: this.buildMessages(request),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    }) as { choices?: { message?: { content?: string } }[] } | null;
    return data?.choices?.[0]?.message?.content ?? null;
  }

  async completeWithTools(request: LLMRequest, tools: LLMTool[]): Promise<LLMToolCall | null> {
    const data = await this.post({
      model: this.model,
      messages: this.buildMessages(request),
      tools,
      tool_choice: "required",
      temperature: 0,
      max_tokens: 100,
    }) as { choices?: { message?: { tool_calls?: { function: { name: string; arguments: string } }[] } }[] } | null;

    const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return null;

    try {
      return { name: tc.function.name, arguments: JSON.parse(tc.function.arguments || "{}") };
    } catch {
      return { name: tc.function.name, arguments: {} };
    }
  }
}
