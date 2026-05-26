import {
  createXyaVoryx,
  defineAgent,
  InMemoryStore,
  MockLLMProvider,
  StacktraceParserTool,
  TestOutputParserTool
} from "@xyavoryx/sdk";

async function main(): Promise<void> {
  const runtime = createXyaVoryx({
    memory: new InMemoryStore()
  });

  runtime.registerProvider(new MockLLMProvider());
  runtime.registerTool(StacktraceParserTool);
  runtime.registerTool(TestOutputParserTool);

  const bugbotAgent = defineAgent({
    id: "bugbot-triage",
    name: "Bugbot Triage",
    goal: "Perform deterministic bug triage from stacktrace and test output.",
    tools: ["stacktrace.parser", "test.output.parser"],
    workflow: [
      {
        id: "stacktrace-parse",
        tool: "stacktrace.parser",
        inputFrom: "rawInput",
        inputKey: "stacktrace"
      },
      {
        id: "test-output-parse",
        tool: "test.output.parser",
        inputFrom: "rawInput",
        inputKey: "output"
      }
    ],
    policies: {
      allowNetwork: false,
      allowFilesystem: false,
      maxToolExecutions: 10
    }
  });

  const sampleInput = [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "    at parseUser (src/services/user.ts:42:15)",
    "    at buildProfile (src/controllers/profile.ts:18:5)",
    "FAIL tests/profile.test.ts",
    "  x should build profile for active user",
    "  AssertionError: expected true to be false"
  ].join("\n");

  const result = await runtime.runAgent(bugbotAgent, {
    task: "Triage CI failure with stacktrace and test logs",
    rawInput: sampleInput
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("bugbot-agent failed", error);
  process.exitCode = 1;
});