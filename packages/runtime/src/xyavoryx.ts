import type {
  AgentConfig,
  AgentInput,
  AgentResult,
  EvaluationScenario,
  EvaluationSuiteResult,
  Logger,
  MemoryStore,
  PolicyConfig,
  XyaVoryxTool,
  LLMProvider
} from "@xyavoryx/core";
import { AgentRunner } from "./agent-runner";
import { ConsoleLogger } from "./console-logger";
import { DeterministicPlanner } from "./deterministic-planner";
import { DeterministicRuntimeContext } from "./deterministic-runtime-context";
import { EvaluationHarness } from "./evaluation-harness";
import { EventBus } from "./event-bus";
import { PolicyEngine } from "./policy-engine";
import { PolicyProfileRegistry, type PolicyProfileMap } from "./policy-profile-registry";
import { ProviderRegistry } from "./provider-registry";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";

export interface XyaVoryxOptions {
  memory: MemoryStore;
  logger?: Logger;
  runtimeContext?: DeterministicRuntimeContext;
  policyProfiles?: PolicyProfileMap;
}

export class XyaVoryx {
  private readonly toolRegistry = new ToolRegistry();
  private readonly providerRegistry = new ProviderRegistry();
  private readonly eventBus = new EventBus();
  private readonly planner = new DeterministicPlanner();
  private readonly policyEngine = new PolicyEngine();
  private readonly policyProfiles: PolicyProfileRegistry;
  private readonly toolExecutor = new ToolExecutor();
  private readonly logger: Logger;
  private readonly runtimeContext: DeterministicRuntimeContext;

  constructor(private readonly options: XyaVoryxOptions) {
    this.logger = options.logger ?? new ConsoleLogger();
    this.runtimeContext = options.runtimeContext ?? new DeterministicRuntimeContext();
    this.policyProfiles = new PolicyProfileRegistry(options.policyProfiles);
  }

  registerTool(tool: XyaVoryxTool): this {
    this.toolRegistry.register(tool);
    return this;
  }

  registerProvider(provider: LLMProvider): this {
    this.providerRegistry.register(provider);
    return this;
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  registerPolicyProfile(name: string, config: PolicyConfig): this {
    this.policyProfiles.register(name, config);
    return this;
  }

  async runAgent(agent: AgentConfig, input: AgentInput): Promise<AgentResult> {
    const runner = new AgentRunner({
      memory: this.options.memory,
      logger: this.logger,
      runtimeContext: this.runtimeContext,
      eventBus: this.eventBus,
      toolRegistry: this.toolRegistry,
      providerRegistry: this.providerRegistry,
      planner: this.planner,
      policyEngine: this.policyEngine,
      policyProfiles: this.policyProfiles,
      toolExecutor: this.toolExecutor
    });

    return runner.run(agent, input);
  }

  async runEvaluation(
    scenarios: EvaluationScenario[],
    baseline?: EvaluationSuiteResult
  ): Promise<EvaluationSuiteResult> {
    const harness = new EvaluationHarness((scenario) => this.runAgent(scenario.agent, scenario.input), {
      now: () => this.runtimeContext.now()
    });
    return harness.runSuite(scenarios, baseline);
  }
}
