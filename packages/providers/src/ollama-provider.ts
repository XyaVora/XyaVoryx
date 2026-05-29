import type { LLMGenerateRequest, LLMGenerateResponse, LLMProvider } from "@xyavoryx/core";

export interface OllamaProviderOptions {
  endpoint?: string; // Default: "http://localhost:11434"
  model?: string; // Default: "llama3"
  temperature?: number; // Default: 0.2
  maxTokens?: number; // Optional
}

export class OllamaLLMProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly endpoint: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens?: number;

  constructor(options: OllamaProviderOptions = {}) {
    this.endpoint = (options.endpoint ?? "http://localhost:11434").replace(/\/$/, "");
    this.model = options.model ?? "llama3";
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    const url = `${this.endpoint}/api/chat`;

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
      stream: false,
      options: {
        temperature: tempValue,
        ...(maxTokensValue !== undefined ? { num_predict: maxTokensValue } : {})
      }
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API returned status ${response.status}: ${errorText}`);
      }

      const responseData = (await response.json()) as {
        message?: {
          content?: string;
        };
      };

      const content = responseData.message?.content;
      if (content === undefined) {
        throw new Error("Invalid Ollama API response structure. No chat message content found.");
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
      throw new Error(`Ollama LLM generate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
