import { ILLMAdapter, LLMRequest, LLMTool, LLMMessage, LLMToolResponse } from "../ILLMAdapter.js";
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

  async completeWithTools(messages: LLMMessage[], tools: LLMTool[], systemPrompt?: string): Promise<LLMToolResponse | null> {
    const fullMessages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ];

    const data = await this.post({
      model: this.model,
      messages: fullMessages,
      tools,
      tool_choice: "auto",
      temperature: 0,
      max_tokens: 500,
    }) as { choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] } | null;

    const message = data?.choices?.[0]?.message;
    if (!message) return null;

    const tc = message.tool_calls?.[0];
    if (tc) {
      try {
        return { toolCall: { id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments || "{}") } };
      } catch {
        return { toolCall: { id: tc.id, name: tc.function.name, arguments: {} } };
      }
    }

    if (message.content) return { text: message.content };
    return null;
  }
}
