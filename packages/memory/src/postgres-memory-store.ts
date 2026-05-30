import { Pool } from "pg";
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

export interface PostgreSqlMemoryStoreOptions {
  connectionString?: string;
}

export class PostgreSqlMemoryStore implements MemoryStore {
  private readonly pool: Pool;
  private readonly initialized: Promise<void>;

  constructor(options: PostgreSqlMemoryStoreOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    this.pool = new Pool(connectionString ? { connectionString } : {});
    this.initialized = this.initSchema();
  }

  private async ready(): Promise<void> {
    await this.initialized;
  }

  private async initSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          "agentName" TEXT NOT NULL,
          task TEXT NOT NULL,
          status TEXT NOT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          "sessionId" TEXT NOT NULL,
          "createdAt" TEXT NOT NULL,
          "inputJson" TEXT NOT NULL,
          "metadataJson" TEXT
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS observations (
          id TEXT PRIMARY KEY,
          "sessionId" TEXT NOT NULL,
          "caseId" TEXT NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          "dataJson" TEXT,
          "createdAt" TEXT NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS findings (
          id TEXT PRIMARY KEY,
          "sessionId" TEXT NOT NULL,
          "caseId" TEXT NOT NULL,
          title TEXT NOT NULL,
          severity TEXT NOT NULL,
          description TEXT NOT NULL,
          "sourceTool" TEXT,
          evidence TEXT,
          cwe TEXT,
          owasp TEXT,
          "dataJson" TEXT,
          "createdAt" TEXT NOT NULL,
          "vectorJson" TEXT
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS execution_records (
          id TEXT PRIMARY KEY,
          "caseId" TEXT NOT NULL,
          tool TEXT NOT NULL,
          "inputJson" TEXT NOT NULL,
          "outputJson" TEXT,
          status TEXT NOT NULL,
          "startedAt" TEXT NOT NULL,
          "completedAt" TEXT,
          "durationMs" INTEGER,
          error TEXT
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS traces (
          "caseId" TEXT PRIMARY KEY,
          "traceJson" TEXT NOT NULL
        )
      `);

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  private parseJson(val: any): any {
    if (val === null || val === undefined) return undefined;
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.ready();
    const query = `
      INSERT INTO sessions (id, "agentName", task, status, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(id) DO UPDATE SET
        status = EXCLUDED.status,
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    await this.pool.query(query, [
      session.id,
      session.agentName,
      session.task,
      session.status,
      session.createdAt,
      session.updatedAt
    ]);
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.ready();
    const query = `
      UPDATE sessions
      SET status = $1, "updatedAt" = $2
      WHERE id = $3
    `;
    await this.pool.query(query, [status, new Date().toISOString(), sessionId]);
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    await this.ready();
    const query = `
      SELECT id, "agentName", task, status, "createdAt", "updatedAt"
      FROM sessions
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [sessionId]);
    const row = result.rows[0];
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
    await this.ready();
    const query = `
      INSERT INTO cases (id, "sessionId", "createdAt", "inputJson", "metadataJson")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(id) DO UPDATE SET
        "metadataJson" = EXCLUDED."metadataJson"
    `;
    await this.pool.query(query, [
      record.id,
      record.sessionId,
      record.createdAt,
      JSON.stringify(record.input),
      record.metadata ? JSON.stringify(record.metadata) : "{}"
    ]);
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    await this.ready();
    const query = `
      SELECT id, "sessionId", "createdAt", "inputJson", "metadataJson"
      FROM cases
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [caseId]);
    const row = result.rows[0];
    if (!row) return undefined;

    return {
      id: String(row.id),
      sessionId: String(row.sessionId),
      createdAt: String(row.createdAt),
      input: this.parseJson(row.inputJson),
      metadata: row.metadataJson ? this.parseJson(row.metadataJson) : undefined
    };
  }

  async updateCaseMetadata(caseId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.ready();
    const query = `
      UPDATE cases
      SET "metadataJson" = $1
      WHERE id = $2
    `;
    await this.pool.query(query, [JSON.stringify(metadata), caseId]);
  }

  async addObservation(observation: Observation): Promise<void> {
    await this.ready();
    const query = `
      INSERT INTO observations (id, "sessionId", "caseId", type, message, "dataJson", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await this.pool.query(query, [
      observation.id,
      observation.sessionId,
      observation.caseId,
      observation.type,
      observation.message,
      observation.data ? JSON.stringify(observation.data) : null,
      observation.createdAt
    ]);
  }

  async getObservations(caseId: string): Promise<Observation[]> {
    await this.ready();
    const query = `
      SELECT id, "sessionId", "caseId", type, message, "dataJson", "createdAt"
      FROM observations
      WHERE "caseId" = $1
      ORDER BY "createdAt" ASC
    `;
    const result = await this.pool.query(query, [caseId]);
    return result.rows.map(row => ({
      id: String(row.id),
      sessionId: String(row.sessionId),
      caseId: String(row.caseId),
      type: String(row.type),
      message: String(row.message),
      data: row.dataJson ? this.parseJson(row.dataJson) : undefined,
      createdAt: String(row.createdAt)
    }));
  }

  async addFinding(finding: Finding): Promise<void> {
    await this.ready();
    const vector = VectorEngine.computeVector(finding);
    const vectorJson = JSON.stringify(vector);

    const query = `
      INSERT INTO findings (id, "sessionId", "caseId", title, severity, description, "sourceTool", evidence, cwe, owasp, "dataJson", "createdAt", "vectorJson")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT(id) DO UPDATE SET
        title = EXCLUDED.title,
        severity = EXCLUDED.severity,
        description = EXCLUDED.description,
        evidence = EXCLUDED.evidence,
        cwe = EXCLUDED.cwe,
        owasp = EXCLUDED.owasp,
        "dataJson" = EXCLUDED."dataJson",
        "vectorJson" = EXCLUDED."vectorJson"
    `;
    await this.pool.query(query, [
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
    ]);
  }

  async getFindings(caseId: string): Promise<Finding[]> {
    await this.ready();
    const query = `
      SELECT id, "sessionId", "caseId", title, severity, description, "sourceTool", evidence, cwe, owasp, "dataJson", "createdAt"
      FROM findings
      WHERE "caseId" = $1
      ORDER BY "createdAt" ASC
    `;
    const result = await this.pool.query(query, [caseId]);
    return result.rows.map(row => ({
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
      data: row.dataJson ? this.parseJson(row.dataJson) : undefined,
      createdAt: String(row.createdAt)
    }));
  }

  async searchSimilarFindings(queryText: string, limit: number = 5): Promise<Array<Finding & { score: number }>> {
    await this.ready();
    const queryVector = VectorEngine.computeQueryVector(queryText);
    const query = `
      SELECT id, "sessionId", "caseId", title, severity, description, "sourceTool", evidence, cwe, owasp, "dataJson", "createdAt", "vectorJson"
      FROM findings
    `;
    const result = await this.pool.query(query);
    const results: Array<Finding & { score: number }> = [];

    for (const row of result.rows) {
      if (!row.vectorJson) continue;
      try {
        const itemVector = this.parseJson(row.vectorJson) as number[];
        const score = VectorEngine.cosineSimilarity(queryVector, itemVector);
        if (score > 0.05) {
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
            data: row.dataJson ? this.parseJson(row.dataJson) : undefined,
            createdAt: String(row.createdAt),
            score
          });
        }
      } catch (e) {
        // Ignore vector parsing failures
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async appendExecutionRecord(caseId: string, record: ToolExecutionRecord): Promise<void> {
    await this.ready();
    const query = `
      INSERT INTO execution_records (id, "caseId", tool, "inputJson", "outputJson", status, "startedAt", "completedAt", "durationMs", error)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    await this.pool.query(query, [
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
    ]);
  }

  async getExecutionHistory(caseId: string): Promise<ToolExecutionRecord[]> {
    await this.ready();
    const query = `
      SELECT id, "caseId", tool, "inputJson", "outputJson", status, "startedAt", "completedAt", "durationMs", error
      FROM execution_records
      WHERE "caseId" = $1
      ORDER BY "startedAt" ASC
    `;
    const result = await this.pool.query(query, [caseId]);
    return result.rows.map(row => ({
      id: String(row.id),
      tool: String(row.tool),
      input: this.parseJson(row.inputJson),
      output: row.outputJson ? this.parseJson(row.outputJson) : undefined,
      status: row.status as any,
      startedAt: String(row.startedAt),
      completedAt: row.completedAt ? String(row.completedAt) : undefined,
      durationMs: row.durationMs !== null && row.durationMs !== undefined ? Number(row.durationMs) : undefined,
      error: row.error ? String(row.error) : undefined
    }));
  }

  async saveTrace(caseId: string, trace: ExecutionTrace): Promise<void> {
    await this.ready();
    const query = `
      INSERT INTO traces ("caseId", "traceJson")
      VALUES ($1, $2)
      ON CONFLICT("caseId") DO UPDATE SET
        "traceJson" = EXCLUDED."traceJson"
    `;
    await this.pool.query(query, [caseId, JSON.stringify(trace)]);
  }

  async getTrace(caseId: string): Promise<ExecutionTrace | undefined> {
    await this.ready();
    const query = `
      SELECT "caseId", "traceJson"
      FROM traces
      WHERE "caseId" = $1
    `;
    const result = await this.pool.query(query, [caseId]);
    const row = result.rows[0];
    if (!row) return undefined;

    return this.parseJson(row.traceJson) as ExecutionTrace;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
