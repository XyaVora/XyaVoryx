export interface LLMGenerateRequest {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMGenerateResponse {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  name: string;
  generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse>;
}