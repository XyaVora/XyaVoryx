import type { ExecutionTrace, ToolExecutionRecord, XyaVoryxEvent } from "@xyavoryx/core";

export class TraceRecorder {
  private trace: ExecutionTrace;

  constructor(trace: ExecutionTrace) {
    this.trace = {
      ...trace,
      toolExecutions: [...trace.toolExecutions],
      events: [...trace.events]
    };
  }

  recordEvent(event: XyaVoryxEvent): void {
    this.trace.events.push(event);
  }

  recordToolExecution(record: ToolExecutionRecord): void {
    this.trace.toolExecutions.push(record);
  }

  complete(completedAt: string): void {
    this.trace.completedAt = completedAt;
  }

  snapshot(): ExecutionTrace {
    return {
      ...this.trace,
      toolExecutions: [...this.trace.toolExecutions],
      events: [...this.trace.events]
    };
  }
}