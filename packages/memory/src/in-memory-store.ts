import type {
  CaseRecord,
  ExecutionTrace,
  Finding,
  MemoryStore,
  Observation,
  SessionRecord,
  SessionStatus,
  ToolExecutionRecord
} from "@xyavoryx/core";

export class InMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly cases = new Map<string, CaseRecord>();
  private readonly observationsByCase = new Map<string, Observation[]>();
  private readonly findingsByCase = new Map<string, Finding[]>();
  private readonly executionHistoryByCase = new Map<string, ToolExecutionRecord[]>();
  private readonly traceByCase = new Map<string, ExecutionTrace>();

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.sessions.set(sessionId, {
      ...session,
      status
    });
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  async createCase(record: CaseRecord): Promise<void> {
    this.cases.set(record.id, {
      ...record,
      input: {
        ...record.input,
        context: record.input.context ? { ...record.input.context } : undefined
      }
    });
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    const record = this.cases.get(caseId);
    if (!record) {
      return undefined;
    }

    return {
      ...record,
      input: {
        ...record.input,
        context: record.input.context ? { ...record.input.context } : undefined
      }
    };
  }

  async addObservation(observation: Observation): Promise<void> {
    const list = this.observationsByCase.get(observation.caseId) ?? [];
    list.push({ ...observation, data: observation.data ? { ...observation.data } : undefined });
    this.observationsByCase.set(observation.caseId, list);
  }

  async getObservations(caseId: string): Promise<Observation[]> {
    const list = this.observationsByCase.get(caseId) ?? [];
    return list.map((observation) => ({
      ...observation,
      data: observation.data ? { ...observation.data } : undefined
    }));
  }

  async addFinding(finding: Finding): Promise<void> {
    const list = this.findingsByCase.get(finding.caseId) ?? [];
    list.push({ ...finding, data: finding.data ? { ...finding.data } : undefined });
    this.findingsByCase.set(finding.caseId, list);
  }

  async getFindings(caseId: string): Promise<Finding[]> {
    const list = this.findingsByCase.get(caseId) ?? [];
    return list.map((finding) => ({
      ...finding,
      data: finding.data ? { ...finding.data } : undefined
    }));
  }

  async appendExecutionRecord(caseId: string, record: ToolExecutionRecord): Promise<void> {
    const list = this.executionHistoryByCase.get(caseId) ?? [];
    list.push({ ...record });
    this.executionHistoryByCase.set(caseId, list);
  }

  async getExecutionHistory(caseId: string): Promise<ToolExecutionRecord[]> {
    const list = this.executionHistoryByCase.get(caseId) ?? [];
    return list.map((record) => ({ ...record }));
  }

  async saveTrace(caseId: string, trace: ExecutionTrace): Promise<void> {
    this.traceByCase.set(caseId, {
      ...trace,
      toolExecutions: trace.toolExecutions.map((record) => ({ ...record })),
      events: trace.events.map((event) => ({ ...event, payload: event.payload ? { ...event.payload } : undefined }))
    });
  }

  async getTrace(caseId: string): Promise<ExecutionTrace | undefined> {
    const trace = this.traceByCase.get(caseId);
    if (!trace) {
      return undefined;
    }

    return {
      ...trace,
      toolExecutions: trace.toolExecutions.map((record) => ({ ...record })),
      events: trace.events.map((event) => ({ ...event, payload: event.payload ? { ...event.payload } : undefined }))
    };
  }
}