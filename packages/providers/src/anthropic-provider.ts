import type { LLMGenerateRequest, LLMGenerateResponse, LLMProvider } from "@xyavoryx/core";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string; // Default: "claude-3-5-sonnet-latest"
  temperature?: number; // Default: 0.2
  maxTokens?: number; // Default: 4096
}

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    if (!options.apiKey) {
      throw new Error("Anthropic API key must be provided.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-3-5-sonnet-latest";
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    const url = "https://api.anthropic.com/v1/messages";

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
      max_tokens: maxTokensValue
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API returned status ${response.status}: ${errorText}`);
      }

      const responseData = (await response.json()) as {
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      };

      const content = responseData.content?.[0]?.text;
      if (content === undefined) {
        throw new Error("Invalid Anthropic API response structure. No generated text found.");
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
      throw new Error(`Anthropic LLM generate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
