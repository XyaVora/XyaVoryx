import type {
  AgentConfig,
  AgentInput,
  AutonomousDecision,
  Observation,
  Finding,
  LLMProvider,
  XyaVoryxTool
} from "@xyavoryx/core";

export class AutonomousPlanner {
  constructor(private readonly provider: LLMProvider) {}

  async planNextAction(
    agent: AgentConfig,
    input: AgentInput,
    state: {
      observations: Observation[];
      findings: Finding[];
      availableTools: XyaVoryxTool[];
    }
  ): Promise<AutonomousDecision> {
    const toolsList = state.availableTools
      .map(
        (tool) =>
          `- Tool Name: "${tool.name}"\n  Description: "${tool.description}"`
      )
      .join("\n");

    const obsList = state.observations.length > 0
      ? state.observations
          .map(
            (o, index) =>
              `${index + 1}. [${o.type}] ${o.message} (Data: ${JSON.stringify(
                o.data
              )})`
          )
          .join("\n")
      : "No observations recorded yet.";

    const findingsList = state.findings.length > 0
      ? state.findings
          .map(
            (f, index) =>
              `${index + 1}. [Severity: ${f.severity}] ${f.title}: ${f.description}`
          )
          .join("\n")
      : "No findings recorded yet.";

    const prompt = [
      `You are an autonomous AI security investigator agent named "${agent.name}".`,
      `Your overarching goal is: "${agent.goal}"`,
      `Your current assigned task is: "${input.task}"`,
      input.rawInput ? `Raw Input under investigation:\n"""\n${input.rawInput}\n"""` : "",
      input.context && Object.keys(input.context).length > 0
        ? `Investigation Context & History:\n${JSON.stringify(input.context, null, 2)}`
        : "",
      `Available Security Tools:`,
      toolsList,
      `Current Investigation Observations:`,
      obsList,
      `Current Findings Derived:`,
      findingsList,
      `Your job is to decide the next step. You must respond in EXACTLY the following JSON format. Do not write any conversational text before or after the JSON block.`,
      `JSON Response Schema:`,
      `{`,
      `  "thought": "Your analytical thought process reasoning about the findings and deciding the next step.",`,
      `  "action": "call" or "finish",`,
      `  "tool": "Optional. The name of the tool to call next (required if action is 'call')",`,
      `  "input": "Optional. The exact input payload required by the tool (required if action is 'call')",`,
      `  "report": "Optional. The final markdown summary report of the investigation (required if action is 'finish')"`,
      `}`
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await this.provider.generate({
      prompt,
      temperature: 0.1
    });

    return this.parseDecision(response.content);
  }

  private parseDecision(content: string): AutonomousDecision {
    const cleanContent = content.trim();

    // Try parsing the entire content first
    try {
      return JSON.parse(cleanContent) as AutonomousDecision;
    } catch (e) {
      // If it fails, try finding a JSON block {...} in the text
      const match = /\{[\s\S]*\}/.exec(cleanContent);
      if (match) {
        try {
          return JSON.parse(match[0]) as AutonomousDecision;
        } catch (innerErr) {
          // Fallback on JSON parse error
        }
      }

      // Safe fallback if JSON parsing completely fails
      return {
        thought: `Failed to parse LLM response: ${cleanContent}`,
        action: "finish",
        report: `Investigation aborted due to planner parsing failure. LLM output was:\n\n${cleanContent}`
      };
    }
  }
}
