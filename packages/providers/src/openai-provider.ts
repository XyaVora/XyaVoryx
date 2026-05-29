import type { LLMGenerateRequest, LLMGenerateResponse, LLMProvider } from "@xyavoryx/core";

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string; // Default: "gpt-4o-mini"
  temperature?: number; // Default: 0.2
  maxTokens?: number; // Optional
}

export class OpenAILLMProvider implements LLMProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens?: number;

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI API key is required.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-4o-mini";
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    const url = "https://api.openai.com/v1/chat/completions";

    const tempValue = request.temperature ?? this.temperature;
    const maxTokensValue = request.maxTokens ?? this.maxTokens;

    const payload = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: request.prompt
        }
      ],
      temperature: tempValue,
      ...(maxTokensValue !== undefined ? { max_tokens: maxTokensValue } : {})
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API returned status ${response.status}: ${errorText}`);
      }

      const responseData = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      const content = responseData.choices?.[0]?.message?.content;
      if (content === undefined) {
        throw new Error("Invalid OpenAI API response structure. No generated text found.");
      }

      return {
        content,
        metadata: {
          provider: this.name,
          model: this.model,
          temperature: tempValue
        }
      };
    } catch (error) {
      throw new Error(`OpenAI LLM generate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
