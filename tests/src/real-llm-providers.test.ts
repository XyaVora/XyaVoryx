import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GeminiLLMProvider } from "@xyavoryx/providers";
import { OpenAILLMProvider } from "@xyavoryx/providers";
import { AnthropicLLMProvider } from "@xyavoryx/providers";
import { OllamaLLMProvider } from "@xyavoryx/providers";

describe("Real LLM Providers", () => {
  let fetchSpy = vi.spyOn(global, "fetch");

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GeminiLLMProvider", () => {
    it("should throw an error if API key is missing", () => {
      expect(() => new GeminiLLMProvider({ apiKey: "" })).toThrow("Gemini API key is required.");
    });

    it("should format request payloads and parse success responses correctly", async () => {
      const mockResponseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Hello from Gemini!"
                }
              ]
            }
          }
        ]
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new GeminiLLMProvider({
        apiKey: "test-gemini-key",
        model: "gemini-1.5-pro",
        temperature: 0.3,
        maxTokens: 100
      });

      const response = await provider.generate({
        prompt: "Say Hello",
        temperature: 0.4,
        maxTokens: 50
      });

      expect(response.content).toBe("Hello from Gemini!");
      expect(response.metadata).toEqual({
        provider: "gemini",
        model: "gemini-1.5-pro",
        temperature: 0.4
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];

      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=test-gemini-key");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({
        contents: [
          {
            parts: [
              {
                text: "Say Hello"
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 50
        }
      });
    });

    it("should fallback to default options when generate request omits parameters", async () => {
      const mockResponseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Gemini fallback response"
                }
              ]
            }
          }
        ]
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new GeminiLLMProvider({
        apiKey: "test-gemini-key"
      });

      const response = await provider.generate({
        prompt: "Say fallback"
      });

      expect(response.content).toBe("Gemini fallback response");
      expect(response.metadata).toEqual({
        provider: "gemini",
        model: "gemini-2.5-flash",
        temperature: 0.2
      });

      const [url, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.generationConfig).toEqual({
        temperature: 0.2
      });
    });

    it("should handle error status code responses appropriately", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "API Key invalid"
      } as Response);

      const provider = new GeminiLLMProvider({
        apiKey: "invalid-key"
      });

      await expect(provider.generate({ prompt: "Hello" })).rejects.toThrow(
        "Gemini LLM generate failed: Gemini API returned status 400: API Key invalid"
      );
    });
  });

  describe("OpenAILLMProvider", () => {
    it("should throw an error if API key is missing", () => {
      expect(() => new OpenAILLMProvider({ apiKey: "" })).toThrow("OpenAI API key is required.");
    });

    it("should format request payloads and parse success responses correctly", async () => {
      const mockResponseData = {
        choices: [
          {
            message: {
              content: "Hello from OpenAI!"
            }
          }
        ]
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new OpenAILLMProvider({
        apiKey: "test-openai-key",
        model: "gpt-4o",
        temperature: 0.1,
        maxTokens: 200
      });

      const response = await provider.generate({
        prompt: "Say OpenAI",
        temperature: 0.5,
        maxTokens: 80
      });

      expect(response.content).toBe("Hello from OpenAI!");
      expect(response.metadata).toEqual({
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.5
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];

      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-openai-key");

      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: "Say OpenAI"
          }
        ],
        temperature: 0.5,
        max_tokens: 80
      });
    });

    it("should fallback to default options when generate request omits parameters", async () => {
      const mockResponseData = {
        choices: [
          {
            message: {
              content: "OpenAI fallback response"
            }
          }
        ]
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new OpenAILLMProvider({
        apiKey: "test-openai-key"
      });

      const response = await provider.generate({
        prompt: "Say fallback"
      });

      expect(response.content).toBe("OpenAI fallback response");
      expect(response.metadata).toEqual({
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2
      });

      const [url, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.temperature).toBe(0.2);
      expect(body.max_tokens).toBeUndefined();
    });

    it("should handle error status code responses appropriately", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized"
      } as Response);

      const provider = new OpenAILLMProvider({
        apiKey: "invalid-key"
      });

      await expect(provider.generate({ prompt: "Hello" })).rejects.toThrow(
        "OpenAI LLM generate failed: OpenAI API returned status 401: Unauthorized"
      );
    });
  });

  describe("AnthropicLLMProvider", () => {
    it("should throw an error if API key is missing", () => {
      expect(() => new AnthropicLLMProvider({ apiKey: "" })).toThrow("Anthropic API key must be provided.");
    });

    it("should format request payloads and parse success responses correctly", async () => {
      const mockResponseData = {
        content: [
          {
            type: "text",
            text: "Hello from Claude!"
          }
        ]
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new AnthropicLLMProvider({
        apiKey: "test-anthropic-key",
        model: "claude-3-opus-latest",
        temperature: 0.1,
        maxTokens: 1000
      });

      const response = await provider.generate({
        prompt: "Say Claude",
        temperature: 0.5,
        maxTokens: 500
      });

      expect(response.content).toBe("Hello from Claude!");
      expect(response.metadata).toEqual({
        provider: "anthropic",
        model: "claude-3-opus-latest",
        temperature: 0.5
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];

      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-anthropic-key");
      expect((init?.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");

      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({
        model: "claude-3-opus-latest",
        messages: [
          {
            role: "user",
            content: "Say Claude"
          }
        ],
        temperature: 0.5,
        max_tokens: 500
      });
    });

    it("should fallback to default options when generate request omits parameters", async () => {
      const mockResponseData = {
        content: [
          {
            type: "text",
            text: "Claude fallback response"
          }
        ]
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new AnthropicLLMProvider({
        apiKey: "test-anthropic-key"
      });

      const response = await provider.generate({
        prompt: "Say fallback"
      });

      expect(response.content).toBe("Claude fallback response");
      expect(response.metadata).toEqual({
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        temperature: 0.2
      });

      const [url, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("claude-3-5-sonnet-latest");
      expect(body.temperature).toBe(0.2);
      expect(body.max_tokens).toBe(4096);
    });

    it("should handle error status code responses appropriately", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden"
      } as Response);

      const provider = new AnthropicLLMProvider({
        apiKey: "invalid-key"
      });

      await expect(provider.generate({ prompt: "Hello" })).rejects.toThrow(
        "Anthropic LLM generate failed: Anthropic API returned status 403: Forbidden"
      );
    });
  });

  describe("OllamaLLMProvider", () => {
    it("should format request payloads and parse success responses correctly", async () => {
      const mockResponseData = {
        message: {
          role: "assistant",
          content: "Hello from Ollama!"
        }
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new OllamaLLMProvider({
        endpoint: "http://127.0.0.1:11434/",
        model: "llama3",
        temperature: 0.1,
        maxTokens: 500
      });

      const response = await provider.generate({
        prompt: "Say Ollama",
        temperature: 0.5,
        maxTokens: 250
      });

      expect(response.content).toBe("Hello from Ollama!");
      expect(response.metadata).toEqual({
        provider: "ollama",
        model: "llama3",
        temperature: 0.5
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];

      expect(url).toBe("http://127.0.0.1:11434/api/chat");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({
        model: "llama3",
        messages: [
          {
            role: "user",
            content: "Say Ollama"
          }
        ],
        stream: false,
        options: {
          temperature: 0.5,
          num_predict: 250
        }
      });
    });

    it("should fallback to default options when generate request omits parameters", async () => {
      const mockResponseData = {
        message: {
          role: "assistant",
          content: "Ollama fallback response"
        }
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
        text: async () => JSON.stringify(mockResponseData)
      } as Response);

      const provider = new OllamaLLMProvider();

      const response = await provider.generate({
        prompt: "Say fallback"
      });

      expect(response.content).toBe("Ollama fallback response");
      expect(response.metadata).toEqual({
        provider: "ollama",
        model: "llama3",
        temperature: 0.2
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("http://localhost:11434/api/chat");
      
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("llama3");
      expect(body.options).toEqual({
        temperature: 0.2
      });
    });

    it("should handle error status code responses appropriately", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      } as Response);

      const provider = new OllamaLLMProvider();

      await expect(provider.generate({ prompt: "Hello" })).rejects.toThrow(
        "Ollama LLM generate failed: Ollama API returned status 500: Internal Server Error"
      );
    });
  });
});
