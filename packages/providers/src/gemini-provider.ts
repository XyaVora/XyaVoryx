import type { LLMGenerateRequest, LLMGenerateResponse, LLMProvider } from "@xyavoryx/core";

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string; // Default: "gemini-2.5-flash"
  temperature?: number; // Default: 0.2
  maxTokens?: number; // Optional
}

export class GeminiLLMProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens?: number;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) {
      throw new Error("Gemini API key is required.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-2.5-flash";
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const tempValue = request.temperature ?? this.temperature;
    const maxTokensValue = request.maxTokens ?? this.maxTokens;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: request.prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: tempValue,
        ...(maxTokensValue !== undefined ? { maxOutputTokens: maxTokensValue } : {})
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
        throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
      }

      const responseData = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }>;
      };

      const content = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content === undefined) {
        throw new Error("Invalid Gemini API response structure. No generated text found.");
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
      throw new Error(`Gemini LLM generate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
