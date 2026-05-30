import * as path from "node:path";
import * as fs from "node:fs";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Use dynamic resolver helper to bypass Vitest/Vite static resolution bugs with native node:sqlite
const DatabaseSyncClass = (() => {
  try {
    if (typeof module !== "undefined" && typeof module.require === "function") {
      return module.require("node:sqlite").DatabaseSync;
    }
    return require("node:sqlite").DatabaseSync;
  } catch (e) {
    try {
      return require("node:sqlite").DatabaseSync;
    } catch (inner) {
      return null as any;
    }
  }
})();
import type {
  MemoryStore,
  SessionRecord,
  SessionStatus,
  CaseRecord,
  Observation,
  Finding,
  ToolExecutionRecord,
  ExecutionTrace
} from "@xyavoryx/core";
import { VectorEngine } from "./vector-engine";

export interface SqliteMemoryStoreOptions {
  dbPath?: string;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: DatabaseSyncType;

  constructor(options: SqliteMemoryStoreOptions = {}) {
    const targetPath = options.dbPath ?? ":memory:";
    if (targetPath !== ":memory:") {
      const dir = path.dirname(path.resolve(targetPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSyncClass(targetPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agentName TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        inputJson TEXT NOT NULL,
        metadataJson TEXT
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        caseId TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        dataJson TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        caseId TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT NOT NULL,
        sourceTool TEXT,
        evidence TEXT,
        cwe TEXT,
        owasp TEXT,
        dataJson TEXT,
        createdAt TEXT NOT NULL,
        vectorJson TEXT
      );

      CREATE TABLE IF NOT EXISTS execution_records (
        id TEXT PRIMARY KEY,
        caseId TEXT NOT NULL,
        tool TEXT NOT NULL,
        inputJson TEXT NOT NULL,
        outputJson TEXT,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        durationMs INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS traces (
        caseId TEXT PRIMARY KEY,
        traceJson TEXT NOT NULL
      );
    `);
  }

  async createSession(session: SessionRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agentName, task, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(
      session.id,
      session.agentName,
      session.task,
      session.status,
      session.createdAt,
      session.updatedAt
    );
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = ?, updatedAt = ?
      WHERE id = ?
    `);
    stmt.run(status, new Date().toISOString(), sessionId);
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const stmt = this.db.prepare(`
      SELECT id, agentName, task, status, createdAt, updatedAt
      FROM sessions
      WHERE id = ?
    `);
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    return {
      id: String(row.id),
      agentName: String(row.agentName),
      task: String(row.task),
      status: row.status as SessionStatus,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  }

  async createCase(record: CaseRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO cases (id, sessionId, createdAt, inputJson, metadataJson)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        metadataJson = excluded.metadataJson
    `);
    stmt.run(
      record.id,
      record.sessionId,
      record.createdAt,
      JSON.stringify(record.input),
      record.metadata ? JSON.stringify(record.metadata) : "{}"
    );
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    const stmt = this.db.prepare(`
      SELECT id, sessionId, createdAt, inputJson, metadataJson
      FROM cases
      WHERE id = ?
    `);
    const row = stmt.get(caseId) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    return {
      id: String(row.id),
      sessionId: String(row.sessionId),
      createdAt: String(row.createdAt),
      input: JSON.parse(String(row.inputJson)),
      metadata: row.metadataJson ? JSON.parse(String(row.metadataJson)) : undefined
    };
  }

  async updateCaseMetadata(caseId: string, metadata: Record<string, unknown>): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE cases
      SET metadataJson = ?
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(metadata), caseId);
  }

  async addObservation(observation: Observation): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO observations (id, sessionId, caseId, type, message, dataJson, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      observation.id,
      observation.sessionId,
      observation.caseId,
      observation.type,
      observation.message,
      observation.data ? JSON.stringify(observation.data) : null,
      observation.createdAt
    );
  }

  async getObservations(caseId: string): Promise<Observation[]> {
    const stmt = this.db.prepare(`
      SELECT id, sessionId, caseId, type, message, dataJson, createdAt
      FROM observations
      WHERE caseId = ?
      ORDER BY createdAt ASC
    `);
    const rows = stmt.all(caseId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: String(row.id),
      sessionId: String(row.sessionId),
      caseId: String(row.caseId),
      type: String(row.type),
      message: String(row.message),
      data: row.dataJson ? JSON.parse(String(row.dataJson)) : undefined,
      createdAt: String(row.createdAt)
    }));
  }

  async addFinding(finding: Finding): Promise<void> {
    // Generate semantic keyword vector for dynamic search and historic retrieval
    const vector = VectorEngine.computeVector(finding);
    const vectorJson = JSON.stringify(vector);

    const stmt = this.db.prepare(`
      INSERT INTO findings (id, sessionId, caseId, title, severity, description, sourceTool, evidence, cwe, owasp, dataJson, createdAt, vectorJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        severity = excluded.severity,
        description = excluded.description,
        evidence = excluded.evidence,
        cwe = excluded.cwe,
        owasp = excluded.owasp,
        dataJson = excluded.dataJson,
        vectorJson = excluded.vectorJson
    `);
    stmt.run(
      finding.id,
      finding.sessionId,
      finding.caseId,
      finding.title,
      finding.severity,
      finding.description,
      finding.sourceTool ?? null,
      finding.evidence ?? null,
      finding.cwe ?? null,
      finding.owasp ?? null,
      finding.data ? JSON.stringify(finding.data) : null,
      finding.createdAt,
      vectorJson
    );
  }

  async getFindings(caseId: string): Promise<Finding[]> {
    const stmt = this.db.prepare(`
      SELECT id, sessionId, caseId, title, severity, description, sourceTool, evidence, cwe, owasp, dataJson, createdAt
      FROM findings
      WHERE caseId = ?
      ORDER BY createdAt ASC
    `);
    const rows = stmt.all(caseId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: String(row.id),
      sessionId: String(row.sessionId),
      caseId: String(row.caseId),
      title: String(row.title),
      severity: row.severity as any,
      description: String(row.description),
      sourceTool: row.sourceTool ? String(row.sourceTool) : undefined,
      evidence: row.evidence ? String(row.evidence) : undefined,
      cwe: row.cwe ? String(row.cwe) : undefined,
      owasp: row.owasp ? String(row.owasp) : undefined,
      data: row.dataJson ? JSON.parse(String(row.dataJson)) : undefined,
      createdAt: String(row.createdAt)
    }));
  }

  // Get similar findings across all historical sessions based on vector space cosine similarity
  async searchSimilarFindings(queryText: string, limit: number = 5): Promise<Array<Finding & { score: number }>> {
    const queryVector = VectorEngine.computeQueryVector(queryText);
    const stmt = this.db.prepare(`
      SELECT id, sessionId, caseId, title, severity, description, sourceTool, evidence, cwe, owasp, dataJson, createdAt, vectorJson
      FROM findings
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    const results: Array<Finding & { score: number }> = [];

    for (const row of rows) {
      if (!row.vectorJson) continue;
      try {
        const itemVector = JSON.parse(String(row.vectorJson)) as number[];
        const score = VectorEngine.cosineSimilarity(queryVector, itemVector);
        if (score > 0.05) { // Minimum similarity threshold
          results.push({
            id: String(row.id),
            sessionId: String(row.sessionId),
            caseId: String(row.caseId),
            title: String(row.title),
            severity: row.severity as any,
            description: String(row.description),
            sourceTool: row.sourceTool ? String(row.sourceTool) : undefined,
            evidence: row.evidence ? String(row.evidence) : undefined,
            cwe: row.cwe ? String(row.cwe) : undefined,
            owasp: row.owasp ? String(row.owasp) : undefined,
            data: row.dataJson ? JSON.parse(String(row.dataJson)) : undefined,
            createdAt: String(row.createdAt),
            score
          });
        }
      } catch (e) {
        // Ignore JSON parse errors on vector
      }
    }

    // Sort descending by similarity score
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async appendExecutionRecord(caseId: string, record: ToolExecutionRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO execution_records (id, caseId, tool, inputJson, outputJson, status, startedAt, completedAt, durationMs, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      caseId,
      record.tool,
      JSON.stringify(record.input),
      record.output ? JSON.stringify(record.output) : null,
      record.status,
      record.startedAt,
      record.completedAt ?? null,
      record.durationMs ?? null,
      record.error ?? null
    );
  }

  async getExecutionHistory(caseId: string): Promise<ToolExecutionRecord[]> {
    const stmt = this.db.prepare(`
      SELECT id, caseId, tool, inputJson, outputJson, status, startedAt, completedAt, durationMs, error
      FROM execution_records
      WHERE caseId = ?
      ORDER BY startedAt ASC
    `);
    const rows = stmt.all(caseId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: String(row.id),
      tool: String(row.tool),
      input: JSON.parse(String(row.inputJson)),
      output: row.outputJson ? JSON.parse(String(row.outputJson)) : undefined,
      status: row.status as any,
      startedAt: String(row.startedAt),
      completedAt: row.completedAt ? String(row.completedAt) : undefined,
      durationMs: row.durationMs !== null && row.durationMs !== undefined ? Number(row.durationMs) : undefined,
      error: row.error ? String(row.error) : undefined
    }));
  }

  async saveTrace(caseId: string, trace: ExecutionTrace): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO traces (caseId, traceJson)
      VALUES (?, ?)
      ON CONFLICT(caseId) DO UPDATE SET
        traceJson = excluded.traceJson
    `);
    stmt.run(caseId, JSON.stringify(trace));
  }

  async getTrace(caseId: string): Promise<ExecutionTrace | undefined> {
    const stmt = this.db.prepare(`
      SELECT caseId, traceJson
      FROM traces
      WHERE caseId = ?
    `);
    const row = stmt.get(caseId) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    return JSON.parse(String(row.traceJson)) as ExecutionTrace;
  }
}
