import type {
  AgentConfig,
  AgentInput,
  AgentResult,
  Finding,
  Logger,
  MemoryStore,
  PolicyConfig,
  PolicyRuleConfig,
  ExecutablePlanStep,
  ToolExecutionRecord,
  WorkflowCondition,
  WorkflowFailureAction,
  XyaVoryxEvent,
  XyaVoryxEventType,
  AutonomousDecision,
  XyaVoryxTool
} from "@xyavoryx/core";
import { DeterministicPlanner } from "./deterministic-planner";
import { AutonomousPlanner } from "./autonomous-planner";
import { DeterministicRuntimeContext } from "./deterministic-runtime-context";
import { EventBus } from "./event-bus";
import { PolicyEngine } from "./policy-engine";
import { PolicyProfileRegistry } from "./policy-profile-registry";
import { ProviderRegistry } from "./provider-registry";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import { TraceRecorder } from "./trace-recorder";

export interface AgentRunnerDependencies {
  memory: MemoryStore;
  logger: Logger;
  runtimeContext: DeterministicRuntimeContext;
  eventBus: EventBus;
  toolRegistry: ToolRegistry;
  providerRegistry: ProviderRegistry;
  planner: DeterministicPlanner;
  policyEngine: PolicyEngine;
  policyProfiles: PolicyProfileRegistry;
  toolExecutor: ToolExecutor;
}

export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDependencies) {}

  async run(agent: AgentConfig, input: AgentInput): Promise<AgentResult> {
    const sessionId = this.deps.runtimeContext.nextId("session");
    const caseId = this.deps.runtimeContext.nextId("case");
    const startedAt = this.deps.runtimeContext.now();

    await this.deps.memory.createSession({
      id: sessionId,
      agentName: agent.name,
      task: input.task,
      status: "created",
      createdAt: startedAt,
      updatedAt: startedAt
    });

    await this.deps.memory.createCase({
      id: caseId,
      sessionId,
      createdAt: startedAt,
      input
    });

    const traceRecorder = new TraceRecorder({
      sessionId,
      caseId,
      agentName: agent.name,
      startedAt,
      toolExecutions: [],
      events: []
    });

    const emitEvent = (type: XyaVoryxEventType, payload?: Record<string, unknown>): XyaVoryxEvent => {
      const event: XyaVoryxEvent = {
        id: this.deps.runtimeContext.nextId("event"),
        type,
        timestamp: this.deps.runtimeContext.now(),
        sessionId,
        caseId,
        agentName: agent.name,
        payload
      };
      this.deps.eventBus.emit(event);
      traceRecorder.recordEvent(event);
      return event;
    };

    await this.deps.memory.updateSessionStatus(sessionId, "running");
    emitEvent("agent.started", { task: input.task });
    emitEvent("agent.status_changed", { status: "running" });

    const policy: PolicyConfig | undefined = this.deps.policyProfiles.resolve(agent.policyProfile, agent.policies);

    const isAutonomous = agent.plannerMode === "autonomous" || !agent.workflow || agent.workflow.length === 0;
    if (isAutonomous) {
      return this.runAutonomous(agent, input, sessionId, caseId, startedAt, policy, emitEvent, traceRecorder);
    }

    const plan = this.deps.planner.buildPlan(agent, input);
    const stepIndexById = new Map<string, number>(
      plan.steps.map((step, index) => [step.id, index])
    );
    const maxTransitions = typeof agent.maxIterations === "number" && agent.maxIterations > 0
      ? Math.floor(agent.maxIterations)
      : Math.max(plan.steps.length * 4, 1);
    const stepOutputs = new Map<string, unknown>();
    let executionCount = 0;
    let status: AgentResult["status"] = "completed";
    let stepIndex = 0;
    let transitions = 0;

    while (stepIndex < plan.steps.length) {
      // Transition guard prevents deterministic fallback loops from running forever.
      if (transitions >= maxTransitions) {
        emitEvent("workflow.recovery_failed", {
          reason: "max_transitions_reached",
          maxTransitions
        });
        status = "failed";
        break;
      }
      transitions += 1;
      const step = plan.steps[stepIndex];
      const shouldRun = this.shouldRunStep(step.runIf, step.runIfMode, input, stepOutputs);
      if (!shouldRun) {
        emitEvent("workflow.step_skipped", {
          stepId: step.id,
          tool: step.tool,
          reason: "conditions_not_met"
        });
        stepIndex += 1;
        continue;
      }
      const resolvedStepInput = this.resolveStepInput(step, input, stepOutputs);

      const tool = this.deps.toolRegistry.get(step.tool);
      if (!tool) {
        const toolRecord = this.createExecutionRecord({
          tool: step.tool,
          input: resolvedStepInput,
          status: "failed",
          startedAt: this.deps.runtimeContext.now(),
          completedAt: this.deps.runtimeContext.now(),
          error: `Tool not found: ${step.tool}`
        });
        traceRecorder.recordToolExecution(toolRecord);
        await this.deps.memory.appendExecutionRecord(caseId, toolRecord);
        emitEvent("tool.failed", {
          tool: step.tool,
          error: toolRecord.error
        });

        const recovery = this.resolveFailureRecovery(step.id, step.onFailure, stepIndex, stepIndexById);
        if (!recovery.continueFlow) {
          status = "failed";
          if (recovery.reason) {
            emitEvent("workflow.recovery_failed", {
              stepId: step.id,
              tool: step.tool,
              reason: recovery.reason
            });
          }
          break;
        }

        emitEvent("workflow.step_recovered", {
          stepId: step.id,
          tool: step.tool,
          action: recovery.action,
          nextStepId: recovery.nextStepId
        });
        stepIndex = recovery.nextStepIndex;
        continue;
      }

      const maxRetries = step.maxRetries;
      const scopedPolicy = this.resolveScopedPolicy(policy, tool.name, step.id);
      let stepCompleted = false;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const decision = this.deps.policyEngine.validate({
          toolName: tool.name,
          toolMetadata: tool.metadata,
          executionCount,
          policy: scopedPolicy
        });

        emitEvent("policy.checked", {
          stepId: step.id,
          tool: tool.name,
          attempt: attempt + 1,
          executionCount,
          allowed: decision.allowed,
          reason: decision.reason,
          scope: {
            hasAgentPolicy: !!policy,
            hasToolPolicy: !!policy?.toolPolicies?.[tool.name],
            hasStepPolicy: !!policy?.stepPolicies?.[step.id]
          }
        });

        if (!decision.allowed) {
          const blockedAt = this.deps.runtimeContext.now();
          const toolRecord = this.createExecutionRecord({
            tool: tool.name,
            input: resolvedStepInput,
            status: "blocked",
            startedAt: blockedAt,
            completedAt: this.deps.runtimeContext.now(),
            error: decision.reason
          });

          traceRecorder.recordToolExecution(toolRecord);
          await this.deps.memory.appendExecutionRecord(caseId, toolRecord);
          emitEvent("policy.blocked", {
            tool: tool.name,
            reason: decision.reason,
            attempt: attempt + 1
          });
          status = "blocked";
          break;
        }

        const started = this.deps.runtimeContext.now();
        emitEvent("tool.started", {
          stepId: step.id,
          tool: tool.name,
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1
        });

        try {
          const output = await this.deps.toolExecutor.execute(
            tool,
            resolvedStepInput,
            {
              agentId: agent.id ?? agent.name,
              sessionId,
              caseId,
              memory: this.deps.memory,
              logger: this.deps.logger
            },
            tool.metadata?.timeoutMs ?? scopedPolicy?.defaultTimeoutMs
          );

          const completedAt = this.deps.runtimeContext.now();
          const toolRecord = this.createExecutionRecord({
            tool: tool.name,
            input: resolvedStepInput,
            output,
            status: "completed",
            startedAt: started,
            completedAt
          });
          executionCount += 1;

          traceRecorder.recordToolExecution(toolRecord);
          await this.deps.memory.appendExecutionRecord(caseId, toolRecord);

          emitEvent("tool.completed", {
            tool: tool.name,
            attempt: attempt + 1
          });

          await this.addObservation(caseId, sessionId, tool.name, output, emitEvent);
          const findings = await this.deriveFindings(caseId, sessionId, tool.name, output, emitEvent);

          if (findings.length > 0) {
            this.deps.logger.info("Findings created", {
              tool: tool.name,
              count: findings.length
            });
          }

          stepOutputs.set(step.id, output);

          if (step.project) {
            const projectedMetadata: Record<string, unknown> = {};
            for (const [metadataKey, valuePath] of Object.entries(step.project)) {
              const val = this.resolvePath(output, valuePath);
              if (val !== undefined) {
                projectedMetadata[metadataKey] = val;
              }
            }
            if (Object.keys(projectedMetadata).length > 0) {
              await this.deps.memory.updateCaseMetadata(caseId, projectedMetadata);
              emitEvent("case.metadata_updated" as any, {
                stepId: step.id,
                projectedKeys: Object.keys(projectedMetadata)
              });
            }
          }

          stepCompleted = true;
          break;
        } catch (error) {
          const completedAt = this.deps.runtimeContext.now();
          const message = error instanceof Error ? error.message : String(error);
          const toolRecord = this.createExecutionRecord({
            tool: tool.name,
            input: resolvedStepInput,
            status: "failed",
            startedAt: started,
            completedAt,
            error: message
          });
          executionCount += 1;

          traceRecorder.recordToolExecution(toolRecord);
          await this.deps.memory.appendExecutionRecord(caseId, toolRecord);

          emitEvent("tool.failed", {
            tool: tool.name,
            error: message,
            attempt: attempt + 1,
            willRetry: attempt < maxRetries
          });
        }
      }

      if (stepCompleted) {
        stepIndex += 1;
        continue;
      }

      if (status === "blocked") {
        break;
      }

      const recovery = this.resolveFailureRecovery(step.id, step.onFailure, stepIndex, stepIndexById);
      if (!recovery.continueFlow) {
        status = "failed";
        if (recovery.reason) {
          emitEvent("workflow.recovery_failed", {
            stepId: step.id,
            tool: step.tool,
            reason: recovery.reason
          });
        }
        break;
      }

      emitEvent("workflow.step_recovered", {
        stepId: step.id,
        tool: step.tool,
        action: recovery.action,
        nextStepId: recovery.nextStepId
      });
      stepIndex = recovery.nextStepIndex;
    }

    await this.deps.memory.updateSessionStatus(sessionId, status);
    emitEvent("agent.status_changed", { status });

    const findings = await this.deps.memory.getFindings(caseId);
    const report = this.buildReport(agent.name, status, findings);
    emitEvent("report.generated", { findingCount: findings.length });

    if (status === "completed") {
      emitEvent("agent.completed", { status });
    } else {
      emitEvent("agent.failed", { status });
    }

    const completedAt = this.deps.runtimeContext.now();
    traceRecorder.complete(completedAt);
    const trace = traceRecorder.snapshot();
    await this.deps.memory.saveTrace(caseId, trace);

    return {
      agentName: agent.name,
      caseId,
      sessionId,
      status,
      findings,
      trace,
      report,
      metadata: {
        stepsPlanned: plan.steps.length,
        stepsExecuted: trace.toolExecutions.length
      }
    };
  }

  private createExecutionRecord(params: {
    tool: string;
    input: unknown;
    output?: unknown;
    status: ToolExecutionRecord["status"];
    startedAt: string;
    completedAt: string;
    error?: string;
  }): ToolExecutionRecord {
    const durationMs = Date.parse(params.completedAt) - Date.parse(params.startedAt);

    return {
      id: this.deps.runtimeContext.nextId("tool-exec"),
      tool: params.tool,
      input: params.input,
      output: params.output,
      status: params.status,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      durationMs,
      error: params.error
    };
  }

  private async addObservation(
    caseId: string,
    sessionId: string,
    toolName: string,
    output: unknown,
    emitEvent: (type: XyaVoryxEventType, payload?: Record<string, unknown>) => XyaVoryxEvent
  ): Promise<void> {
    await this.deps.memory.addObservation({
      id: this.deps.runtimeContext.nextId("observation"),
      sessionId,
      caseId,
      type: "tool.output",
      message: `Tool ${toolName} completed`,
      data: {
        tool: toolName,
        output: this.toRecord(output)
      },
      createdAt: this.deps.runtimeContext.now()
    });

    emitEvent("observation.created", {
      tool: toolName
    });
  }

  private async deriveFindings(
    caseId: string,
    sessionId: string,
    toolName: string,
    output: unknown,
    emitEvent: (type: XyaVoryxEventType, payload?: Record<string, unknown>) => XyaVoryxEvent
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const normalizedToolFindings = this.extractToolFindings(output);

    for (const toolFinding of normalizedToolFindings) {
      const finding: Finding = {
        id: this.deps.runtimeContext.nextId("finding"),
        sessionId,
        caseId,
        title: toolFinding.title,
        severity: toolFinding.severity,
        description: toolFinding.description,
        sourceTool: toolName,
        createdAt: this.deps.runtimeContext.now(),
        data: {
          tool: toolName,
          ...(toolFinding.data ?? {})
        }
      };
      await this.deps.memory.addFinding(finding);
      findings.push(finding);
      emitEvent("finding.created", {
        tool: toolName,
        title: finding.title
      });
    }

    if (this.hasRiskArray(output)) {
      for (const risk of output.risks) {
        const finding: Finding = {
          id: this.deps.runtimeContext.nextId("finding"),
          sessionId,
          caseId,
          title: this.resolveRiskFindingTitle(toolName),
          severity: "medium",
          description: risk,
          sourceTool: toolName,
          createdAt: this.deps.runtimeContext.now(),
          data: {
            tool: toolName
          }
        };
        await this.deps.memory.addFinding(finding);
        findings.push(finding);
        emitEvent("finding.created", {
          tool: toolName,
          title: finding.title
        });
      }
    }

    if (this.hasIOCShape(output)) {
      const indicatorCount =
        output.ips.length +
        output.domains.length +
        output.urls.length +
        output.emails.length +
        output.hashes.md5.length +
        output.hashes.sha1.length +
        output.hashes.sha256.length +
        output.cves.length +
        output.filePaths.length;

      if (indicatorCount > 0) {
        const finding: Finding = {
          id: this.deps.runtimeContext.nextId("finding"),
          sessionId,
          caseId,
          title: "Indicators of compromise extracted",
          severity: "medium",
          description: `Extracted ${indicatorCount} indicators`,
          sourceTool: toolName,
          createdAt: this.deps.runtimeContext.now(),
          data: {
            tool: toolName,
            indicatorCount
          }
        };

        await this.deps.memory.addFinding(finding);
        findings.push(finding);
        emitEvent("finding.created", {
          tool: toolName,
          title: finding.title
        });
      }
    }

    return findings;
  }

  private resolveRiskFindingTitle(toolName: string): string {
    if (toolName === "email.header.analyzer") {
      return "Email header risk detected";
    }

    if (toolName === "test.output.parser") {
      return "Test output risk detected";
    }

    if (toolName === "stacktrace.parser") {
      return "Stacktrace risk detected";
    }

    return "Tool risk detected";
  }

  private buildReport(agentName: string, status: AgentResult["status"], findings: Finding[]): string {
    const lines = [
      `Agent: ${agentName}`,
      `Status: ${status}`,
      `Findings: ${findings.length}`
    ];

    for (const finding of findings) {
      lines.push(`[${finding.severity}] ${finding.title}: ${finding.description}`);
    }

    return lines.join("\n");
  }

  private hasRiskArray(value: unknown): value is { risks: string[] } {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as { risks?: unknown };
    return Array.isArray(candidate.risks) && candidate.risks.every((item) => typeof item === "string");
  }

  private extractToolFindings(value: unknown): Array<{
    title: string;
    severity: "low" | "medium" | "high";
    description: string;
    data?: Record<string, unknown>;
  }> {
    if (!value || typeof value !== "object") {
      return [];
    }

    const candidate = value as { findings?: unknown };
    if (!Array.isArray(candidate.findings)) {
      return [];
    }

    const normalized: Array<{
      title: string;
      severity: "low" | "medium" | "high";
      description: string;
      data?: Record<string, unknown>;
    }> = [];

    for (const item of candidate.findings) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const raw = item as Record<string, unknown>;
      if (
        typeof raw.title !== "string" ||
        typeof raw.description !== "string" ||
        (raw.severity !== "low" && raw.severity !== "medium" && raw.severity !== "high")
      ) {
        continue;
      }

      normalized.push({
        title: raw.title,
        description: raw.description,
        severity: raw.severity,
        data: raw.data && typeof raw.data === "object"
          ? (raw.data as Record<string, unknown>)
          : undefined
      });
    }

    return normalized;
  }

  private hasIOCShape(value: unknown): value is {
    ips: string[];
    domains: string[];
    urls: string[];
    emails: string[];
    hashes: { md5: string[]; sha1: string[]; sha256: string[] };
    cves: string[];
    filePaths: string[];
  } {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      this.isStringArray(candidate.ips) &&
      this.isStringArray(candidate.domains) &&
      this.isStringArray(candidate.urls) &&
      this.isStringArray(candidate.emails) &&
      typeof candidate.hashes === "object" &&
      candidate.hashes !== null &&
      this.isStringArray((candidate.hashes as Record<string, unknown>).md5) &&
      this.isStringArray((candidate.hashes as Record<string, unknown>).sha1) &&
      this.isStringArray((candidate.hashes as Record<string, unknown>).sha256) &&
      this.isStringArray(candidate.cves) &&
      this.isStringArray(candidate.filePaths)
    );
  }

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") {
      return { value };
    }

    return value as Record<string, unknown>;
  }

  private shouldRunStep(
    conditions: WorkflowCondition[],
    mode: "all" | "any",
    input: AgentInput,
    stepOutputs: Map<string, unknown>
  ): boolean {
    if (conditions.length === 0) {
      return true;
    }

    const checks = conditions.map((condition) => this.evaluateCondition(condition, input, stepOutputs));
    return mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
  }

  private evaluateCondition(
    condition: WorkflowCondition,
    input: AgentInput,
    stepOutputs: Map<string, unknown>
  ): boolean {
    const left = this.resolveConditionValue(condition, input, stepOutputs);

    if (condition.operator === "exists") {
      return left !== undefined && left !== null;
    }

    if (condition.operator === "equals") {
      return this.isEquivalent(left, condition.value);
    }

    if (condition.operator === "not_equals") {
      return !this.isEquivalent(left, condition.value);
    }

    if (condition.operator === "includes") {
      if (typeof left === "string" && typeof condition.value === "string") {
        return left.includes(condition.value);
      }

      if (Array.isArray(left)) {
        return left.some((item) => this.isEquivalent(item, condition.value));
      }

      return false;
    }

    return false;
  }

  private resolveConditionValue(
    condition: WorkflowCondition,
    input: AgentInput,
    stepOutputs: Map<string, unknown>
  ): unknown {
    if (condition.source === "task") {
      return this.resolvePath(input.task, condition.valuePath);
    }

    if (condition.source === "rawInput") {
      return this.resolvePath(input.rawInput, condition.valuePath);
    }

    if (condition.source === "context") {
      const base = condition.contextKey ? input.context?.[condition.contextKey] : input.context;
      return this.resolvePath(base, condition.valuePath);
    }

    if (condition.source === "stepOutput") {
      if (!condition.stepId) {
        return undefined;
      }
      const base = stepOutputs.get(condition.stepId);
      return this.resolvePath(base, condition.valuePath);
    }

    return undefined;
  }

  private resolveStepInput(
    step: ExecutablePlanStep,
    input: AgentInput,
    stepOutputs: Map<string, unknown>
  ): unknown {
    let sourceValue: unknown;

    if (step.inputFrom === "rawInput") {
      sourceValue = input.rawInput;
    } else if (step.inputFrom === "task") {
      sourceValue = input.task;
    } else if (step.inputFrom === "context") {
      const base = step.contextKey ? input.context?.[step.contextKey] : input.context;
      sourceValue = this.resolvePath(base, step.valuePath);
    } else if (step.inputFrom === "stepOutput") {
      const base = step.sourceStepId ? stepOutputs.get(step.sourceStepId) : undefined;
      sourceValue = this.resolvePath(base, step.valuePath);
    } else {
      sourceValue = step.literalInput;
    }

    return step.inputKey ? { [step.inputKey]: sourceValue } : sourceValue;
  }

  private resolvePath(base: unknown, path?: string): unknown {
    if (!path) {
      return base;
    }

    const parts = path.split(".").filter((part) => part.length > 0);
    let current: unknown = base;

    for (const part of parts) {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private isEquivalent(left: unknown, right: unknown): boolean {
    return JSON.stringify(this.normalizeValue(left)) === JSON.stringify(this.normalizeValue(right));
  }

  private normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item));
    }

    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, item]) => [key, this.normalizeValue(item)]);
      return Object.fromEntries(entries);
    }

    return value;
  }

  private resolveFailureRecovery(
    stepId: string,
    onFailure: WorkflowFailureAction,
    currentStepIndex: number,
    stepIndexById: Map<string, number>
  ): {
    continueFlow: boolean;
    nextStepIndex: number;
    action?: "continue" | "fallback";
    nextStepId?: string;
    reason?: string;
  } {
    if (onFailure.action === "stop") {
      return {
        continueFlow: false,
        nextStepIndex: currentStepIndex,
        reason: "on_failure_stop"
      };
    }

    if (onFailure.action === "continue") {
      return {
        continueFlow: true,
        nextStepIndex: currentStepIndex + 1,
        action: "continue"
      };
    }

    const fallbackStepId = onFailure.fallbackStepId;
    if (!fallbackStepId) {
      return {
        continueFlow: false,
        nextStepIndex: currentStepIndex,
        reason: "missing_fallback_step_id"
      };
    }

    const fallbackIndex = stepIndexById.get(fallbackStepId);
    if (typeof fallbackIndex !== "number") {
      return {
        continueFlow: false,
        nextStepIndex: currentStepIndex,
        reason: `fallback_step_not_found:${fallbackStepId}`
      };
    }

    if (fallbackStepId === stepId) {
      return {
        continueFlow: false,
        nextStepIndex: currentStepIndex,
        reason: "fallback_step_self_reference"
      };
    }

    return {
      continueFlow: true,
      nextStepIndex: fallbackIndex,
      action: "fallback",
      nextStepId: fallbackStepId
    };
  }

  private resolveScopedPolicy(basePolicy: PolicyConfig | undefined, toolName: string, stepId: string): PolicyRuleConfig | undefined {
    if (!basePolicy) {
      return undefined;
    }

    const toolPolicy = basePolicy.toolPolicies?.[toolName];
    const stepPolicy = basePolicy.stepPolicies?.[stepId];

    const mergedWithTool = toolPolicy
      ? this.mergePolicyRules(basePolicy, toolPolicy)
      : this.clonePolicyRule(basePolicy);

    if (!stepPolicy) {
      return mergedWithTool;
    }

    // Precedence order is deterministic: agent base < tool override < step override.
    return this.mergePolicyRules(mergedWithTool, stepPolicy);
  }

  private mergePolicyRules(base: PolicyRuleConfig, override: PolicyRuleConfig): PolicyRuleConfig {
    return {
      allowedTools: this.mergeStringLists(base.allowedTools, override.allowedTools),
      deniedTools: this.mergeStringLists(base.deniedTools, override.deniedTools),
      allowNetwork: override.allowNetwork ?? base.allowNetwork,
      allowFilesystem: override.allowFilesystem ?? base.allowFilesystem,
      maxToolExecutions: override.maxToolExecutions ?? base.maxToolExecutions,
      defaultTimeoutMs: override.defaultTimeoutMs ?? base.defaultTimeoutMs
    };
  }

  private clonePolicyRule(policy: PolicyRuleConfig): PolicyRuleConfig {
    return {
      allowedTools: policy.allowedTools ? [...policy.allowedTools] : undefined,
      deniedTools: policy.deniedTools ? [...policy.deniedTools] : undefined,
      allowNetwork: policy.allowNetwork,
      allowFilesystem: policy.allowFilesystem,
      maxToolExecutions: policy.maxToolExecutions,
      defaultTimeoutMs: policy.defaultTimeoutMs
    };
  }

  private mergeStringLists(base?: string[], override?: string[]): string[] | undefined {
    if (!base && !override) {
      return undefined;
    }

    const merged = new Set<string>([...(base ?? []), ...(override ?? [])]);
    return Array.from(merged);
  }

  private async runAutonomous(
    agent: AgentConfig,
    input: AgentInput,
    sessionId: string,
    caseId: string,
    startedAt: string,
    policy: PolicyConfig | undefined,
    emitEvent: (type: XyaVoryxEventType, payload?: Record<string, unknown>) => XyaVoryxEvent,
    traceRecorder: TraceRecorder
  ): Promise<AgentResult> {
    const providerName = agent.provider ?? "mock-llm";
    const provider = this.deps.providerRegistry.get(providerName);
    if (!provider) {
      throw new Error(`LLM Provider not found: ${providerName}`);
    }

    const planner = new AutonomousPlanner(provider);
    const maxIterations = typeof agent.maxIterations === "number" && agent.maxIterations > 0
      ? Math.floor(agent.maxIterations)
      : 5;

    let executionCount = 0;
    let status: AgentResult["status"] = "completed";
    let iterations = 0;
    let finalReport = "";

    while (iterations < maxIterations) {
      iterations += 1;

      const observations = await this.deps.memory.getObservations(caseId);
      const findings = await this.deps.memory.getFindings(caseId);

      const availableTools = agent.tools
        .map((name) => this.deps.toolRegistry.get(name))
        .filter((t): t is XyaVoryxTool => !!t);

      const decision = await planner.planNextAction(agent, input, {
        observations,
        findings,
        availableTools
      });

      this.deps.logger.info("Autonomous planner decision", {
        iteration: iterations,
        thought: decision.thought,
        action: decision.action
      });

      emitEvent("workflow.step_recovered" as any, {
        thought: decision.thought,
        action: decision.action,
        tool: decision.tool
      });

      if (decision.action === "finish") {
        finalReport = decision.report ?? `Goal achieved autonomously in ${iterations} iterations.`;
        break;
      }

      if (decision.action === "call") {
        const toolName = decision.tool;
        if (!toolName) {
          status = "failed";
          emitEvent("workflow.recovery_failed" as any, {
            reason: "autonomous_planner_missing_tool_name"
          });
          break;
        }

        const tool = this.deps.toolRegistry.get(toolName);
        if (!tool) {
          status = "failed";
          emitEvent("tool.failed", {
            tool: toolName,
            error: `Tool not found: ${toolName}`
          });
          break;
        }

        const resolvedStepInput = decision.input;
        const scopedPolicy = this.resolveScopedPolicy(policy, tool.name, `auto-${iterations}`);

        const validationDecision = this.deps.policyEngine.validate({
          toolName: tool.name,
          toolMetadata: tool.metadata,
          executionCount,
          policy: scopedPolicy
        });

        emitEvent("policy.checked", {
          stepId: `auto-${iterations}`,
          tool: tool.name,
          attempt: 1,
          executionCount,
          allowed: validationDecision.allowed,
          reason: validationDecision.reason,
          scope: {
            hasAgentPolicy: !!policy,
            hasToolPolicy: !!policy?.toolPolicies?.[tool.name],
            hasStepPolicy: false
          }
        });

        if (!validationDecision.allowed) {
          const blockedAt = this.deps.runtimeContext.now();
          const toolRecord = this.createExecutionRecord({
            tool: tool.name,
            input: resolvedStepInput,
            status: "blocked",
            startedAt: blockedAt,
            completedAt: this.deps.runtimeContext.now(),
            error: validationDecision.reason
          });

          traceRecorder.recordToolExecution(toolRecord);
          await this.deps.memory.appendExecutionRecord(caseId, toolRecord);
          emitEvent("policy.blocked", {
            tool: tool.name,
            reason: validationDecision.reason,
            attempt: 1
          });
          status = "blocked";
          break;
        }

        const started = this.deps.runtimeContext.now();
        emitEvent("tool.started", {
          stepId: `auto-${iterations}`,
          tool: tool.name,
          attempt: 1,
          maxAttempts: 1
        });

        try {
          const output = await this.deps.toolExecutor.execute(
            tool,
            resolvedStepInput,
            {
              agentId: agent.id ?? agent.name,
              sessionId,
              caseId,
              memory: this.deps.memory,
              logger: this.deps.logger
            },
            tool.metadata?.timeoutMs ?? scopedPolicy?.defaultTimeoutMs
          );

          const completedAt = this.deps.runtimeContext.now();
          const toolRecord = this.createExecutionRecord({
            tool: tool.name,
            input: resolvedStepInput,
            output,
            status: "completed",
            startedAt: started,
            completedAt
          });
          executionCount += 1;

          traceRecorder.recordToolExecution(toolRecord);
          await this.deps.memory.appendExecutionRecord(caseId, toolRecord);

          emitEvent("tool.completed", {
            tool: tool.name,
            attempt: 1
          });

          await this.addObservation(caseId, sessionId, tool.name, output, emitEvent);
          const findings = await this.deriveFindings(caseId, sessionId, tool.name, output, emitEvent);

          if (findings.length > 0) {
            this.deps.logger.info("Findings created", {
              tool: tool.name,
              count: findings.length
            });
          }
        } catch (error) {
          const completedAt = this.deps.runtimeContext.now();
          const message = error instanceof Error ? error.message : String(error);
          const toolRecord = this.createExecutionRecord({
            tool: tool.name,
            input: resolvedStepInput,
            status: "failed",
            startedAt: started,
            completedAt,
            error: message
          });
          executionCount += 1;

          traceRecorder.recordToolExecution(toolRecord);
          await this.deps.memory.appendExecutionRecord(caseId, toolRecord);

          emitEvent("tool.failed", {
            tool: tool.name,
            error: message,
            attempt: 1,
            willRetry: false
          });

          status = "failed";
          break;
        }
      }
    }

    if (iterations >= maxIterations && status !== "blocked" && finalReport === "") {
      status = "failed";
      emitEvent("workflow.recovery_failed" as any, {
        reason: "max_iterations_reached",
        maxIterations
      });
    }

    await this.deps.memory.updateSessionStatus(sessionId, status);
    emitEvent("agent.status_changed", { status });

    const findings = await this.deps.memory.getFindings(caseId);
    const report = finalReport || this.buildReport(agent.name, status, findings);
    emitEvent("report.generated", { findingCount: findings.length });

    if (status === "completed") {
      emitEvent("agent.completed", { status });
    } else {
      emitEvent("agent.failed", { status });
    }

    const completedAt = this.deps.runtimeContext.now();
    traceRecorder.complete(completedAt);
    const trace = traceRecorder.snapshot();
    await this.deps.memory.saveTrace(caseId, trace);

    return {
      agentName: agent.name,
      caseId,
      sessionId,
      status,
      findings,
      trace,
      report,
      metadata: {
        iterations,
        stepsExecuted: trace.toolExecutions.length
      }
    };
  }
}
