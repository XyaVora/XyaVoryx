import type { LLMGenerateRequest, LLMGenerateResponse, LLMProvider } from "@xyavoryx/core";

export interface MockLLMProviderOptions {
  name?: string;
  responses?: Record<string, string>;
  defaultResponse?: string;
}

export class MockLLMProvider implements LLMProvider {
  readonly name: string;
  private readonly responses: Record<string, string>;
  private readonly defaultResponse: string;

  constructor(options?: MockLLMProviderOptions) {
    this.name = options?.name ?? "mock-llm";
    this.responses = options?.responses ?? {};
    this.defaultResponse = options?.defaultResponse ?? "mock-response";
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    let content = this.responses[request.prompt];

    if (!content) {
      for (const [key, value] of Object.entries(this.responses)) {
        if (request.prompt.includes(key)) {
          content = value;
          break;
        }
      }
    }

    if (!content) {
      content = this.defaultResponse;
    }

    return {
      content,
      metadata: {
        provider: this.name,
        deterministic: true
      }
    };
  }
}