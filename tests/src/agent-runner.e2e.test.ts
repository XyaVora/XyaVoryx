import { describe, expect, it } from "vitest";
import type { AgentConfig, XyaVoryxTool } from "../../packages/core/src";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { DeterministicRuntimeContext } from "../../packages/runtime/src/deterministic-runtime-context";
import { XyaVoryx } from "../../packages/runtime/src/xyavoryx";
import { EmailHeaderAnalyzerTool } from "../../packages/tools/src/email-header-analyzer-tool";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

function buildAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: "agent-1",
    name: "Phishing Agent",
    goal: "Analyze suspicious email",
    tools: ["email.header.analyzer", "ioc.extractor"],
    workflow: [
      {
        id: "step-email",
        tool: "email.header.analyzer",
        inputFrom: "rawInput",
        inputKey: "rawEmail"
      },
      {
        id: "step-ioc",
        tool: "ioc.extractor",
        inputFrom: "rawInput",
        inputKey: "text"
      }
    ],
    ...overrides
  };
}

const SAMPLE_EMAIL = [
  "From: Admin <admin@secure-contoso.com>",
  "To: employee@contoso.com",
  "Subject: Urgent password reset",
  "Return-Path: <mailer@external-attacker.net>",
  "Received: from attacker.net by mx.contoso.com",
  "Authentication-Results: mx.contoso.com; spf=fail; dkim=none; dmarc=fail",
  "",
  "Click https://bad.example/login and contact phish@bad.example"
].join("\n");

describe("AgentRunner end-to-end", () => {
  it("runs workflow, generates trace, and stores findings", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(buildAgent(), {
      task: "Investigate email",
      rawInput: SAMPLE_EMAIL
    });

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.events.some((event) => event.type === "report.generated")).toBe(true);
    expect(result.trace.events.some((event) => event.type === "agent.completed")).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);

    const persistedTrace = await memory.getTrace(result.caseId);
    expect(persistedTrace?.toolExecutions).toHaveLength(2);
  });

  it("blocks denied tool and records blocked status", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(
      buildAgent({
        policies: {
          deniedTools: ["ioc.extractor"]
        }
      }),
      {
        task: "Investigate email",
        rawInput: SAMPLE_EMAIL
      }
    );

    expect(result.status).toBe("blocked");
    expect(result.trace.toolExecutions.some((record) => record.status === "blocked")).toBe(true);
    expect(result.trace.events.some((event) => event.type === "policy.blocked")).toBe(true);
    expect(result.trace.events.some((event) => event.type === "agent.failed")).toBe(true);
    expect(result.trace.events.some((event) => event.type === "agent.completed")).toBe(false);
  });

  it("applies strict policy profile deterministically", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(
      buildAgent({
        policyProfile: "strict"
      }),
      {
        task: "Investigate email",
        rawInput: SAMPLE_EMAIL
      }
    );

    expect(result.status).toBe("blocked");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.toolExecutions[0]?.status).toBe("completed");
    expect(result.trace.toolExecutions[1]?.status).toBe("blocked");
    expect(result.trace.events.some((event) => event.type === "policy.blocked")).toBe(true);
  });

  it("skips step deterministically when runIf conditions are not met", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(
      buildAgent({
        workflow: [
          {
            id: "step-email",
            tool: "email.header.analyzer",
            inputFrom: "rawInput",
            inputKey: "rawEmail"
          },
          {
            id: "step-ioc",
            tool: "ioc.extractor",
            inputFrom: "rawInput",
            inputKey: "text",
            runIf: [
              {
                source: "stepOutput",
                stepId: "step-email",
                valuePath: "authentication.spf",
                operator: "equals",
                value: "pass"
              }
            ]
          }
        ]
      }),
      {
        task: "Investigate email",
        rawInput: SAMPLE_EMAIL
      }
    );

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(1);
    expect(result.trace.toolExecutions[0]?.tool).toBe("email.header.analyzer");
    expect(result.trace.events.some((event) => event.type === "workflow.step_skipped")).toBe(true);
  });

  it("retries failed step deterministically when maxRetries is configured", async () => {
    let attempts = 0;
    const flakyTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "flaky.tool",
      description: "Fails once then succeeds",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Temporary failure");
        }
        return { ok: true };
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(flakyTool);

    const result = await runtime.runAgent(
      {
        id: "retry-agent",
        name: "Retry Agent",
        goal: "Retry deterministically",
        tools: ["flaky.tool"],
        workflow: [
          {
            id: "retry-step",
            tool: "flaky.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            maxRetries: 1
          }
        ]
      },
      {
        task: "Retry test"
      }
    );

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.toolExecutions[0]?.status).toBe("failed");
    expect(result.trace.toolExecutions[1]?.status).toBe("completed");

    const failedEvent = result.trace.events.find((event) => event.type === "tool.failed");
    expect(failedEvent?.payload?.willRetry).toBe(true);
  });

  it("continues workflow deterministically when onFailure is continue", async () => {
    const alwaysFailTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "always.fail.tool",
      description: "Always fails",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        throw new Error("forced failure");
      }
    };

    const successTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "success.tool",
      description: "Always succeeds",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        return { ok: true };
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(alwaysFailTool);
    runtime.registerTool(successTool);

    const result = await runtime.runAgent(
      {
        id: "continue-on-failure-agent",
        name: "Continue on Failure Agent",
        goal: "Continue after controlled failure",
        tools: ["always.fail.tool", "success.tool"],
        workflow: [
          {
            id: "step-fail",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "continue" }
          },
          {
            id: "step-success",
            tool: "success.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" }
          }
        ]
      },
      {
        task: "Continue on failure"
      }
    );

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.toolExecutions[0]?.status).toBe("failed");
    expect(result.trace.toolExecutions[1]?.status).toBe("completed");
    const recovered = result.trace.events.find((event) => event.type === "workflow.step_recovered");
    expect(recovered?.payload?.action).toBe("continue");
  });

  it("jumps to fallback step deterministically when onFailure is fallback", async () => {
    const alwaysFailTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "always.fail.tool",
      description: "Always fails",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        throw new Error("forced failure");
      }
    };

    const successTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "success.tool",
      description: "Always succeeds",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        return { ok: true };
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(alwaysFailTool);
    runtime.registerTool(successTool);

    const result = await runtime.runAgent(
      {
        id: "fallback-on-failure-agent",
        name: "Fallback on Failure Agent",
        goal: "Jump to fallback step after controlled failure",
        tools: ["always.fail.tool", "success.tool"],
        workflow: [
          {
            id: "step-fail",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "fallback", fallbackStepId: "step-rescue" }
          },
          {
            id: "step-should-skip",
            tool: "success.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" }
          },
          {
            id: "step-rescue",
            tool: "success.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" }
          }
        ]
      },
      {
        task: "Fallback on failure"
      }
    );

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.toolExecutions[0]?.tool).toBe("always.fail.tool");
    expect(result.trace.toolExecutions[1]?.tool).toBe("success.tool");
    const recovered = result.trace.events.find((event) => event.type === "workflow.step_recovered");
    expect(recovered?.payload?.action).toBe("fallback");
    expect(recovered?.payload?.nextStepId).toBe("step-rescue");
  });

  it("fails deterministically when fallback step does not exist", async () => {
    const alwaysFailTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "always.fail.tool",
      description: "Always fails",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        throw new Error("forced failure");
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(alwaysFailTool);

    const result = await runtime.runAgent(
      {
        id: "invalid-fallback-agent",
        name: "Invalid Fallback Agent",
        goal: "Fail on invalid fallback deterministically",
        tools: ["always.fail.tool"],
        workflow: [
          {
            id: "step-fail",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "fallback", fallbackStepId: "missing-step" }
          }
        ]
      },
      {
        task: "Invalid fallback"
      }
    );

    expect(result.status).toBe("failed");
    expect(result.trace.events.some((event) => event.type === "workflow.recovery_failed")).toBe(true);
  });

  it("fails deterministically when fallback step id is missing", async () => {
    const alwaysFailTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "always.fail.tool",
      description: "Always fails",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        throw new Error("forced failure");
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(alwaysFailTool);

    const result = await runtime.runAgent(
      {
        id: "missing-fallback-id-agent",
        name: "Missing Fallback Id Agent",
        goal: "Fail on missing fallback id deterministically",
        tools: ["always.fail.tool"],
        workflow: [
          {
            id: "step-fail",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "fallback" }
          }
        ]
      },
      {
        task: "Missing fallback id"
      }
    );

    expect(result.status).toBe("failed");
    const failureEvent = result.trace.events.find((event) => event.type === "workflow.recovery_failed");
    expect(failureEvent?.payload?.reason).toBe("missing_fallback_step_id");
  });

  it("fails deterministically when fallback step references itself", async () => {
    const alwaysFailTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "always.fail.tool",
      description: "Always fails",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        throw new Error("forced failure");
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(alwaysFailTool);

    const result = await runtime.runAgent(
      {
        id: "self-fallback-agent",
        name: "Self Fallback Agent",
        goal: "Fail on self fallback deterministically",
        tools: ["always.fail.tool"],
        workflow: [
          {
            id: "step-fail",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "fallback", fallbackStepId: "step-fail" }
          }
        ]
      },
      {
        task: "Self fallback"
      }
    );

    expect(result.status).toBe("failed");
    const failureEvent = result.trace.events.find((event) => event.type === "workflow.recovery_failed");
    expect(failureEvent?.payload?.reason).toBe("fallback_step_self_reference");
  });

  it("stops deterministic recovery loop at max transitions", async () => {
    const alwaysFailTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "always.fail.tool",
      description: "Always fails",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        throw new Error("forced failure");
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(alwaysFailTool);

    const result = await runtime.runAgent(
      {
        id: "loop-guard-agent",
        name: "Loop Guard Agent",
        goal: "Stop deterministic fallback loop",
        tools: ["always.fail.tool"],
        maxIterations: 3,
        workflow: [
          {
            id: "step-a",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "fallback", fallbackStepId: "step-b" }
          },
          {
            id: "step-b",
            tool: "always.fail.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" },
            onFailure: { action: "fallback", fallbackStepId: "step-a" }
          }
        ]
      },
      {
        task: "Loop guard"
      }
    );

    expect(result.status).toBe("failed");
    const failureEvent = result.trace.events.find((event) => event.type === "workflow.recovery_failed");
    expect(failureEvent?.payload?.reason).toBe("max_transitions_reached");
  });

  it("applies policy precedence agent < tool < step deterministically", async () => {
    const filesystemTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "filesystem.tool",
      description: "Requires filesystem access",
      metadata: {
        requiresFilesystem: true
      },
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(): Promise<{ ok: boolean }> {
        return { ok: true };
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(filesystemTool);

    const result = await runtime.runAgent(
      {
        id: "policy-precedence-agent",
        name: "Policy Precedence Agent",
        goal: "Validate policy precedence",
        tools: ["filesystem.tool"],
        workflow: [
          {
            id: "step-filesystem",
            tool: "filesystem.tool",
            inputFrom: "literal",
            literalInput: { text: "payload" }
          }
        ],
        policies: {
          allowFilesystem: false,
          toolPolicies: {
            "filesystem.tool": {
              allowFilesystem: true
            }
          },
          stepPolicies: {
            "step-filesystem": {
              allowFilesystem: false
            }
          }
        }
      },
      {
        task: "Check precedence"
      }
    );

    expect(result.status).toBe("blocked");
    const blocked = result.trace.toolExecutions.find((record) => record.status === "blocked");
    expect(blocked).toBeDefined();

    const policyChecked = result.trace.events.find((event) => event.type === "policy.checked");
    expect(policyChecked).toBeDefined();
    expect(policyChecked?.payload?.allowed).toBe(false);
    expect((policyChecked?.payload?.scope as { hasStepPolicy?: boolean })?.hasStepPolicy).toBe(true);
  });

  it("emits policy.checked with allowed=true for successful policy evaluation", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(buildAgent(), {
      task: "Investigate email",
      rawInput: SAMPLE_EMAIL
    });

    const checkedEvents = result.trace.events.filter((event) => event.type === "policy.checked");
    expect(checkedEvents.length).toBe(2);
    expect(checkedEvents.every((event) => event.payload?.allowed === true)).toBe(true);
  });

  it("maps step output into downstream step input deterministically", async () => {
    let capturedInput: { text: string } | null = null;

    const producerTool: XyaVoryxTool<{ text: string }, { nested: { token: string } }> = {
      name: "producer.tool",
      description: "Produces deterministic output payload",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { nested: { token: string } }>["inputSchema"],
      async run(): Promise<{ nested: { token: string } }> {
        return {
          nested: {
            token: "token-123"
          }
        };
      }
    };

    const consumerTool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "consumer.tool",
      description: "Consumes step output token",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(input): Promise<{ ok: boolean }> {
        capturedInput = input;
        return { ok: true };
      }
    };

    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(producerTool);
    runtime.registerTool(consumerTool);

    const result = await runtime.runAgent(
      {
        id: "workflow-variable-agent",
        name: "Workflow Variable Agent",
        goal: "Map output to input deterministically",
        tools: ["producer.tool", "consumer.tool"],
        workflow: [
          {
            id: "step-producer",
            tool: "producer.tool",
            inputFrom: "literal",
            literalInput: {
              text: "seed"
            }
          },
          {
            id: "step-consumer",
            tool: "consumer.tool",
            inputFrom: "stepOutput",
            sourceStepId: "step-producer",
            valuePath: "nested.token",
            inputKey: "text"
          }
        ]
      },
      {
        task: "Map workflow variable"
      }
    );

    expect(result.status).toBe("completed");
    expect(capturedInput).toEqual({ text: "token-123" });
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.toolExecutions[1]?.input).toEqual({ text: "token-123" });
  });

  it("projects step output into case metadata deterministically", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);

    const result = await runtime.runAgent(
      {
        id: "projection-agent",
        name: "Projection Agent",
        goal: "Project step output to case metadata",
        tools: ["email.header.analyzer"],
        workflow: [
          {
            id: "step-email",
            tool: "email.header.analyzer",
            inputFrom: "rawInput",
            inputKey: "rawEmail",
            project: {
              sender: "from",
              spfStatus: "authentication.spf"
            }
          }
        ]
      },
      {
        task: "Investigate email",
        rawInput: SAMPLE_EMAIL
      }
    );

    expect(result.status).toBe("completed");

    // Retrieve the case record to verify the projected metadata
    const caseRecord = await memory.getCase(result.caseId);
    expect(caseRecord?.metadata).toEqual({
      sender: "Admin <admin@secure-contoso.com>",
      spfStatus: "fail"
    });

    // Check if the event was emitted
    const metadataUpdatedEvent = result.trace.events.find(
      (event) => event.type === "case.metadata_updated"
    );
    expect(metadataUpdatedEvent).toBeDefined();
    expect(metadataUpdatedEvent?.payload?.stepId).toBe("step-email");
    expect(metadataUpdatedEvent?.payload?.projectedKeys).toEqual(["sender", "spfStatus"]);
  });
});
