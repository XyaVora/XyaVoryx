import type { PolicyConfig, PolicyProfileName, PolicyRuleConfig } from "@xyavoryx/core";

export type PolicyProfileMap = Record<string, PolicyConfig>;

const BUILTIN_POLICY_PROFILES: Record<PolicyProfileName, PolicyConfig> = {
  default: {
    allowNetwork: false,
    allowFilesystem: false
  },
  strict: {
    allowNetwork: false,
    allowFilesystem: false,
    maxToolExecutions: 1
  },
  investigation: {
    allowNetwork: false,
    allowFilesystem: false,
    maxToolExecutions: 16
  }
};

export class PolicyProfileRegistry {
  private readonly profiles = new Map<string, PolicyConfig>();

  constructor(seedProfiles?: PolicyProfileMap) {
    for (const [name, config] of Object.entries(BUILTIN_POLICY_PROFILES)) {
      this.profiles.set(name, this.clonePolicy(config));
    }

    if (seedProfiles) {
      for (const [name, config] of Object.entries(seedProfiles)) {
        this.register(name, config);
      }
    }
  }

  register(name: string, config: PolicyConfig): void {
    this.profiles.set(name, this.clonePolicy(config));
  }

  get(name: string): PolicyConfig | undefined {
    const config = this.profiles.get(name);
    if (!config) {
      return undefined;
    }

    return this.clonePolicy(config);
  }

  resolve(policyProfile?: string, policyOverrides?: PolicyConfig): PolicyConfig | undefined {
    const profileName = policyProfile ?? policyOverrides?.profile;
    const base = profileName ? this.get(profileName) : undefined;

    if (!base && profileName) {
      throw new Error(`Unknown policy profile: ${profileName}`);
    }

    if (!base && !policyOverrides) {
      return undefined;
    }

    if (!base) {
      return this.clonePolicy(policyOverrides as PolicyConfig);
    }

    if (!policyOverrides) {
      return this.clonePolicy(base);
    }

    return this.merge(base, policyOverrides);
  }

  private merge(base: PolicyConfig, overrides: PolicyConfig): PolicyConfig {
    const merged: PolicyConfig = {
      ...this.mergeRule(base, overrides),
      profile: overrides.profile ?? base.profile,
      toolPolicies: this.mergeScopedPolicies(base.toolPolicies, overrides.toolPolicies),
      stepPolicies: this.mergeScopedPolicies(base.stepPolicies, overrides.stepPolicies)
    };

    return merged;
  }

  private mergeRule(base: PolicyRuleConfig, overrides: PolicyRuleConfig): PolicyRuleConfig {
    return {
      allowedTools: this.mergeStringLists(base.allowedTools, overrides.allowedTools),
      deniedTools: this.mergeStringLists(base.deniedTools, overrides.deniedTools),
      allowNetwork: overrides.allowNetwork ?? base.allowNetwork,
      allowFilesystem: overrides.allowFilesystem ?? base.allowFilesystem,
      maxToolExecutions: overrides.maxToolExecutions ?? base.maxToolExecutions,
      defaultTimeoutMs: overrides.defaultTimeoutMs ?? base.defaultTimeoutMs
    };
  }

  private mergeScopedPolicies(
    base?: Record<string, PolicyRuleConfig>,
    overrides?: Record<string, PolicyRuleConfig>
  ): Record<string, PolicyRuleConfig> | undefined {
    if (!base && !overrides) {
      return undefined;
    }

    const keys = new Set<string>([
      ...Object.keys(base ?? {}),
      ...Object.keys(overrides ?? {})
    ]);
    const merged: Record<string, PolicyRuleConfig> = {};

    for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
      const baseRule = base?.[key];
      const overrideRule = overrides?.[key];
      if (baseRule && overrideRule) {
        merged[key] = this.mergeRule(baseRule, overrideRule);
      } else if (overrideRule) {
        merged[key] = this.cloneRule(overrideRule);
      } else if (baseRule) {
        merged[key] = this.cloneRule(baseRule);
      }
    }

    return merged;
  }

  private mergeStringLists(base?: string[], overrides?: string[]): string[] | undefined {
    if (!base && !overrides) {
      return undefined;
    }

    const merged = new Set<string>([...(base ?? []), ...(overrides ?? [])]);
    return Array.from(merged);
  }

  private clonePolicy(policy: PolicyConfig): PolicyConfig {
    return {
      ...this.cloneRule(policy),
      profile: policy.profile,
      toolPolicies: policy.toolPolicies
        ? Object.fromEntries(
            Object.entries(policy.toolPolicies).map(([key, value]) => [key, this.cloneRule(value)])
          )
        : undefined,
      stepPolicies: policy.stepPolicies
        ? Object.fromEntries(
            Object.entries(policy.stepPolicies).map(([key, value]) => [key, this.cloneRule(value)])
          )
        : undefined
    };
  }

  private cloneRule(policy: PolicyRuleConfig): PolicyRuleConfig {
    return {
      allowedTools: policy.allowedTools ? [...policy.allowedTools] : undefined,
      deniedTools: policy.deniedTools ? [...policy.deniedTools] : undefined,
      allowNetwork: policy.allowNetwork,
      allowFilesystem: policy.allowFilesystem,
      maxToolExecutions: policy.maxToolExecutions,
      defaultTimeoutMs: policy.defaultTimeoutMs
    };
  }
}
