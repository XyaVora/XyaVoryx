import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

interface FileMemoryState {
  sessions: Record<string, SessionRecord>;
  cases: Record<string, CaseRecord>;
  observationsByCase: Record<string, Observation[]>;
  findingsByCase: Record<string, Finding[]>;
  executionHistoryByCase: Record<string, ToolExecutionRecord[]>;
  traceByCase: Record<string, ExecutionTrace>;
}

export interface FileMemoryStoreOptions {
  baseDir: string;
}

const STATE_FILENAME = "state.json";

export class FileMemoryStore implements MemoryStore {
  private readonly statePath: string;
  private readonly state: FileMemoryState = {
    sessions: {},
    cases: {},
    observationsByCase: {},
    findingsByCase: {},
    executionHistoryByCase: {},
    traceByCase: {}
  };
  private readonly initialized: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: FileMemoryStoreOptions) {
    this.statePath = join(options.baseDir, STATE_FILENAME);
    this.initialized = this.load();
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.ready();
    this.state.sessions[session.id] = this.cloneSession(session);
    await this.persist();
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.ready();
    const session = this.state.sessions[sessionId];
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.state.sessions[sessionId] = {
      ...session,
      status
    };
    await this.persist();
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    await this.ready();
    const session = this.state.sessions[sessionId];
    return session ? this.cloneSession(session) : undefined;
  }

  async createCase(record: CaseRecord): Promise<void> {
    await this.ready();
    this.state.cases[record.id] = this.cloneCase(record);
    await this.persist();
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    await this.ready();
    const record = this.state.cases[caseId];
    return record ? this.cloneCase(record) : undefined;
  }

  async updateCaseMetadata(caseId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.ready();
    const record = this.state.cases[caseId];
    if (!record) {
      throw new Error(`Case not found: ${caseId}`);
    }

    this.state.cases[caseId] = {
      ...record,
      metadata: {
        ...(record.metadata ?? {}),
        ...metadata
      }
    };
    await this.persist();
  }

  async addObservation(observation: Observation): Promise<void> {
    await this.ready();
    const list = this.state.observationsByCase[observation.caseId] ?? [];
    list.push(this.cloneObservation(observation));
    this.state.observationsByCase[observation.caseId] = list;
    await this.persist();
  }

  async getObservations(caseId: string): Promise<Observation[]> {
    await this.ready();
    const list = this.state.observationsByCase[caseId] ?? [];
    return list.map((item) => this.cloneObservation(item));
  }

  async addFinding(finding: Finding): Promise<void> {
    await this.ready();
    const list = this.state.findingsByCase[finding.caseId] ?? [];
    list.push(this.cloneFinding(finding));
    this.state.findingsByCase[finding.caseId] = list;
    await this.persist();
  }

  async getFindings(caseId: string): Promise<Finding[]> {
    await this.ready();
    const list = this.state.findingsByCase[caseId] ?? [];
    return list.map((item) => this.cloneFinding(item));
  }

  async appendExecutionRecord(caseId: string, record: ToolExecutionRecord): Promise<void> {
    await this.ready();
    const list = this.state.executionHistoryByCase[caseId] ?? [];
    list.push(this.cloneExecutionRecord(record));
    this.state.executionHistoryByCase[caseId] = list;
    await this.persist();
  }

  async getExecutionHistory(caseId: string): Promise<ToolExecutionRecord[]> {
    await this.ready();
    const list = this.state.executionHistoryByCase[caseId] ?? [];
    return list.map((item) => this.cloneExecutionRecord(item));
  }

  async saveTrace(caseId: string, trace: ExecutionTrace): Promise<void> {
    await this.ready();
    this.state.traceByCase[caseId] = this.cloneTrace(trace);
    await this.persist();
  }

  async getTrace(caseId: string): Promise<ExecutionTrace | undefined> {
    await this.ready();
    const trace = this.state.traceByCase[caseId];
    return trace ? this.cloneTrace(trace) : undefined;
  }

  private async ready(): Promise<void> {
    await this.initialized;
  }

  private async load(): Promise<void> {
    await mkdir(this.options.baseDir, { recursive: true });
    const raw = await this.readStateFile();
    if (!raw) {
      return;
    }

    this.state.sessions = this.sortRecordEntries(raw.sessions ?? {});
    this.state.cases = this.sortRecordEntries(raw.cases ?? {});
    this.state.observationsByCase = this.sortRecordEntries(raw.observationsByCase ?? {});
    this.state.findingsByCase = this.sortRecordEntries(raw.findingsByCase ?? {});
    this.state.executionHistoryByCase = this.sortRecordEntries(raw.executionHistoryByCase ?? {});
    this.state.traceByCase = this.sortRecordEntries(raw.traceByCase ?? {});
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const snapshot = this.snapshot();
      const tmpPath = `${this.statePath}.tmp`;
      await mkdir(dirname(this.statePath), { recursive: true });
      await writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(tmpPath, this.statePath);
    });

    await this.writeChain;
  }

  private async readStateFile(): Promise<Partial<FileMemoryState> | undefined> {
    try {
      const content = await readFile(this.statePath, "utf8");
      return JSON.parse(content) as Partial<FileMemoryState>;
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private snapshot(): FileMemoryState {
    return {
      sessions: this.sortRecordEntries(
        Object.fromEntries(
          Object.entries(this.state.sessions).map(([key, value]) => [key, this.cloneSession(value)])
        )
      ),
      cases: this.sortRecordEntries(
        Object.fromEntries(
          Object.entries(this.state.cases).map(([key, value]) => [key, this.cloneCase(value)])
        )
      ),
      observationsByCase: this.sortRecordEntries(
        Object.fromEntries(
          Object.entries(this.state.observationsByCase).map(([key, value]) => [
            key,
            value.map((item) => this.cloneObservation(item))
          ])
        )
      ),
      findingsByCase: this.sortRecordEntries(
        Object.fromEntries(
          Object.entries(this.state.findingsByCase).map(([key, value]) => [
            key,
            value.map((item) => this.cloneFinding(item))
          ])
        )
      ),
      executionHistoryByCase: this.sortRecordEntries(
        Object.fromEntries(
          Object.entries(this.state.executionHistoryByCase).map(([key, value]) => [
            key,
            value.map((item) => this.cloneExecutionRecord(item))
          ])
        )
      ),
      traceByCase: this.sortRecordEntries(
        Object.fromEntries(
          Object.entries(this.state.traceByCase).map(([key, value]) => [key, this.cloneTrace(value)])
        )
      )
    };
  }

  private sortRecordEntries<T>(value: Record<string, T>): Record<string, T> {
    const sorted = Object.entries(value).sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(sorted);
  }

  private cloneSession(value: SessionRecord): SessionRecord {
    return { ...value };
  }

  private cloneCase(value: CaseRecord): CaseRecord {
    return {
      ...value,
      input: {
        ...value.input,
        context: value.input.context ? { ...value.input.context } : undefined
      },
      metadata: value.metadata ? { ...value.metadata } : undefined
    };
  }

  private cloneObservation(value: Observation): Observation {
    return {
      ...value,
      data: value.data ? { ...value.data } : undefined
    };
  }

  private cloneFinding(value: Finding): Finding {
    return {
      ...value,
      data: value.data ? { ...value.data } : undefined
    };
  }

  private cloneExecutionRecord(value: ToolExecutionRecord): ToolExecutionRecord {
    return { ...value };
  }

  private cloneTrace(value: ExecutionTrace): ExecutionTrace {
    return {
      ...value,
      toolExecutions: value.toolExecutions.map((item) => this.cloneExecutionRecord(item)),
      events: value.events.map((event) => ({
        ...event,
        payload: event.payload ? { ...event.payload } : undefined
      }))
    };
  }
}
