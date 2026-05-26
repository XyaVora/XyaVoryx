import type {
  AgentResult,
  EvaluationCheckResult,
  EvaluationMetricTrend,
  EvaluationQualityMetrics,
  EvaluationScenario,
  EvaluationScenarioMetrics,
  EvaluationScenarioResult,
  EvaluationSuiteResult,
  EvaluationTrendSummary
} from "@xyavoryx/core";

export interface EvaluationHarnessOptions {
  now?: () => string;
}

export class EvaluationHarness {
  private readonly now: () => string;

  constructor(
    private readonly runAgent: (scenario: EvaluationScenario) => Promise<AgentResult>,
    options?: EvaluationHarnessOptions
  ) {
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  async runSuite(
    scenarios: EvaluationScenario[],
    baseline?: EvaluationSuiteResult
  ): Promise<EvaluationSuiteResult> {
    const startedAt = this.now();
    const results: EvaluationScenarioResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runAgent(scenario);
      const checks = this.evaluateScenario(scenario, result);
      const metrics = this.buildScenarioMetrics(result, checks);
      results.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passed: checks.every((check) => check.passed),
        checks,
        result,
        metrics
      });
    }

    const completedAt = this.now();
    const passed = results.filter((item) => item.passed).length;
    const total = results.length;
    const passRate = total === 0 ? 0 : passed / total;
    const quality = this.buildSuiteQuality(results);
    const partialSuite: EvaluationSuiteResult = {
      startedAt,
      completedAt,
      total,
      passed,
      failed: total - passed,
      passRate: this.roundNumber(passRate),
      quality,
      scenarios: results
    };
    const trend = baseline ? this.buildTrendSummary(baseline, partialSuite) : undefined;

    return {
      ...partialSuite,
      trend
    };
  }

  private evaluateScenario(scenario: EvaluationScenario, result: AgentResult): EvaluationCheckResult[] {
    const checks: EvaluationCheckResult[] = [];
    const expectations = scenario.expectations;

    if (expectations.status) {
      checks.push({
        name: "status",
        passed: result.status === expectations.status,
        details: `expected=${expectations.status}, actual=${result.status}`
      });
    }

    if (typeof expectations.minFindings === "number") {
      checks.push({
        name: "min_findings",
        passed: result.findings.length >= expectations.minFindings,
        details: `expected>=${expectations.minFindings}, actual=${result.findings.length}`
      });
    }

    if (typeof expectations.maxToolExecutions === "number") {
      checks.push({
        name: "max_tool_executions",
        passed: result.trace.toolExecutions.length <= expectations.maxToolExecutions,
        details: `expected<=${expectations.maxToolExecutions}, actual=${result.trace.toolExecutions.length}`
      });
    }

    if (expectations.requiredEvents && expectations.requiredEvents.length > 0) {
      const eventSet = new Set(result.trace.events.map((event) => event.type));
      for (const requiredEvent of expectations.requiredEvents) {
        checks.push({
          name: `required_event:${requiredEvent}`,
          passed: eventSet.has(requiredEvent),
          details: `event=${requiredEvent}`
        });
      }
    }

    if (expectations.requiredTools && expectations.requiredTools.length > 0) {
      const toolSet = new Set(result.trace.toolExecutions.map((record) => record.tool));
      for (const requiredTool of expectations.requiredTools) {
        checks.push({
          name: `required_tool:${requiredTool}`,
          passed: toolSet.has(requiredTool),
          details: `tool=${requiredTool}`
        });
      }
    }

    return checks;
  }

  private buildScenarioMetrics(result: AgentResult, checks: EvaluationCheckResult[]): EvaluationScenarioMetrics {
    const checksPassed = checks.filter((check) => check.passed).length;
    const checkCount = checks.length;
    const checkPassRate = checkCount === 0 ? 1 : checksPassed / checkCount;

    return {
      findingCount: result.findings.length,
      toolExecutionCount: result.trace.toolExecutions.length,
      eventCount: result.trace.events.length,
      checkCount,
      checksPassed,
      checkPassRate: this.roundNumber(checkPassRate),
      traceCompletenessScore: this.computeTraceCompleteness(result),
      policyComplianceScore: this.computePolicyCompliance(result)
    };
  }

  private buildSuiteQuality(results: EvaluationScenarioResult[]): EvaluationQualityMetrics {
    if (results.length === 0) {
      return {
        checkPassRate: 0,
        averageFindings: 0,
        averageToolExecutions: 0,
        averageEvents: 0,
        traceCompletenessRate: 0,
        policyComplianceRate: 0
      };
    }

    const totals = results.reduce(
      (acc, item) => {
        acc.findings += item.metrics.findingCount;
        acc.toolExecutions += item.metrics.toolExecutionCount;
        acc.events += item.metrics.eventCount;
        acc.checks += item.metrics.checkCount;
        acc.checksPassed += item.metrics.checksPassed;
        acc.traceCompleteness += item.metrics.traceCompletenessScore;
        acc.policyCompliance += item.metrics.policyComplianceScore;
        return acc;
      },
      {
        findings: 0,
        toolExecutions: 0,
        events: 0,
        checks: 0,
        checksPassed: 0,
        traceCompleteness: 0,
        policyCompliance: 0
      }
    );

    return {
      checkPassRate: this.roundNumber(totals.checks === 0 ? 1 : totals.checksPassed / totals.checks),
      averageFindings: this.roundNumber(totals.findings / results.length),
      averageToolExecutions: this.roundNumber(totals.toolExecutions / results.length),
      averageEvents: this.roundNumber(totals.events / results.length),
      traceCompletenessRate: this.roundNumber(totals.traceCompleteness / results.length),
      policyComplianceRate: this.roundNumber(totals.policyCompliance / results.length)
    };
  }

  private computeTraceCompleteness(result: AgentResult): number {
    let checks = 0;
    let passed = 0;

    checks += 1;
    if (typeof result.trace.startedAt === "string" && result.trace.startedAt.length > 0) {
      passed += 1;
    }

    checks += 1;
    if (typeof result.trace.completedAt === "string" && result.trace.completedAt.length > 0) {
      passed += 1;
    }

    checks += 1;
    const hasValidToolRecords = result.trace.toolExecutions.every(
      (record) =>
        typeof record.startedAt === "string" &&
        record.startedAt.length > 0 &&
        typeof record.completedAt === "string" &&
        record.completedAt.length > 0 &&
        (record.status === "completed" || record.status === "failed" || record.status === "blocked")
    );
    if (hasValidToolRecords) {
      passed += 1;
    }

    checks += 1;
    const eventTypes = new Set(result.trace.events.map((event) => event.type));
    const hasTerminalEvents = eventTypes.has("report.generated") && (eventTypes.has("agent.completed") || eventTypes.has("agent.failed"));
    if (hasTerminalEvents) {
      passed += 1;
    }

    return this.roundNumber(passed / checks);
  }

  private computePolicyCompliance(result: AgentResult): number {
    const policyCheckedEvents = result.trace.events.filter((event) => event.type === "policy.checked");
    const indexedChecks = new Set(
      policyCheckedEvents.map((event) => {
        const tool = this.getStringPayloadValue(event.payload, "tool");
        const attempt = this.getNumberPayloadValue(event.payload, "attempt");
        const allowed = this.getBooleanPayloadValue(event.payload, "allowed");
        if (!tool || typeof attempt !== "number" || typeof allowed !== "boolean") {
          return "";
        }
        return `${tool}#${attempt}#${allowed ? "allow" : "deny"}`;
      }).filter((value) => value.length > 0)
    );

    const toolStartedEvents = result.trace.events.filter((event) => event.type === "tool.started");
    const policyBlockedEvents = result.trace.events.filter((event) => event.type === "policy.blocked");
    const guardedActions = toolStartedEvents.length + policyBlockedEvents.length;
    if (guardedActions === 0) {
      return 1;
    }

    let matched = 0;

    for (const event of toolStartedEvents) {
      const tool = this.getStringPayloadValue(event.payload, "tool");
      const attempt = this.getNumberPayloadValue(event.payload, "attempt");
      if (tool && typeof attempt === "number" && indexedChecks.has(`${tool}#${attempt}#allow`)) {
        matched += 1;
      }
    }

    for (const event of policyBlockedEvents) {
      const tool = this.getStringPayloadValue(event.payload, "tool");
      const attempt = this.getNumberPayloadValue(event.payload, "attempt");
      if (tool && typeof attempt === "number" && indexedChecks.has(`${tool}#${attempt}#deny`)) {
        matched += 1;
      }
    }

    return this.roundNumber(matched / guardedActions);
  }

  private getStringPayloadValue(payload: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = payload?.[key];
    return typeof value === "string" ? value : undefined;
  }

  private getNumberPayloadValue(payload: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = payload?.[key];
    return typeof value === "number" ? value : undefined;
  }

  private getBooleanPayloadValue(payload: Record<string, unknown> | undefined, key: string): boolean | undefined {
    const value = payload?.[key];
    return typeof value === "boolean" ? value : undefined;
  }

  private buildTrendSummary(previous: EvaluationSuiteResult, current: EvaluationSuiteResult): EvaluationTrendSummary {
    const metrics: EvaluationMetricTrend[] = [];

    metrics.push(this.compareMetric("pass_rate", previous.passRate, current.passRate, "higher"));
    metrics.push(this.compareMetric("check_pass_rate", previous.quality.checkPassRate, current.quality.checkPassRate, "higher"));
    metrics.push(this.compareMetric("trace_completeness", previous.quality.traceCompletenessRate, current.quality.traceCompletenessRate, "higher"));
    metrics.push(this.compareMetric("policy_compliance", previous.quality.policyComplianceRate, current.quality.policyComplianceRate, "higher"));
    metrics.push(this.compareMetric("failed_scenarios", previous.failed, current.failed, "lower"));

    const improvements = metrics.filter((metric) => metric.better && metric.delta !== 0).length;
    const regressions = metrics.filter((metric) => !metric.better && metric.delta !== 0).length;

    return {
      comparedAt: this.now(),
      verdict: regressions > 0 ? "regressed" : improvements > 0 ? "improved" : "stable",
      improvements,
      regressions,
      metrics
    };
  }

  private compareMetric(
    metric: string,
    previous: number,
    current: number,
    direction: "higher" | "lower"
  ): EvaluationMetricTrend {
    const roundedPrevious = this.roundNumber(previous);
    const roundedCurrent = this.roundNumber(current);
    const delta = this.roundNumber(roundedCurrent - roundedPrevious);
    const trendDirection = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
    const better = direction === "higher" ? delta >= 0 : delta <= 0;

    return {
      metric,
      previous: roundedPrevious,
      current: roundedCurrent,
      delta,
      direction: trendDirection,
      better
    };
  }

  private roundNumber(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }
}
