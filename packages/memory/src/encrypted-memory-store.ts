import * as crypto from "node:crypto";
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

export class EncryptedMemoryStore implements MemoryStore {
  private readonly store: MemoryStore;
  private readonly key: Buffer;

  constructor(store: MemoryStore, encryptionKey?: string) {
    this.store = store;
    const rawKey = encryptionKey ?? process.env.XYAVORYX_ENCRYPTION_KEY;
    if (!rawKey) {
      throw new Error("Encryption key is required. Please set XYAVORYX_ENCRYPTION_KEY in environment.");
    }
    // Derive a standard 256-bit key from passphrase using SHA-256
    this.key = crypto.createHash("sha256").update(rawKey).digest();
  }

  private encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return `v1:${iv.toString("hex")}:${tag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    if (!encryptedText || !encryptedText.startsWith("v1:")) {
      return encryptedText;
    }
    const parts = encryptedText.split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid encrypted data format");
    }
    const [, ivHex, tagHex, cipherTextHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(cipherTextHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  private encryptJson(obj: any): any {
    if (obj === undefined || obj === null) return undefined;
    return {
      __encrypted: this.encrypt(JSON.stringify(obj))
    };
  }

  private decryptJson(encryptedObj: any): any {
    if (!encryptedObj) return undefined;
    if (typeof encryptedObj === "object" && encryptedObj !== null && "__encrypted" in encryptedObj) {
      try {
        const decrypted = this.decrypt(encryptedObj.__encrypted);
        return JSON.parse(decrypted);
      } catch {
        return undefined;
      }
    }
    return encryptedObj;
  }

  private encryptExecutionRecord(record: ToolExecutionRecord): ToolExecutionRecord {
    return {
      ...record,
      input: this.encryptJson(record.input),
      output: record.output ? this.encryptJson(record.output) : undefined,
      error: record.error ? this.encrypt(record.error) : undefined
    };
  }

  private decryptExecutionRecord(record: ToolExecutionRecord): ToolExecutionRecord {
    return {
      ...record,
      input: this.decryptJson(record.input),
      output: record.output ? this.decryptJson(record.output) : undefined,
      error: record.error ? this.decrypt(record.error) : undefined
    };
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.store.createSession(session);
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.store.updateSessionStatus(sessionId, status);
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return await this.store.getSession(sessionId);
  }

  async createCase(record: CaseRecord): Promise<void> {
    const encryptedRecord: CaseRecord = {
      ...record,
      input: this.encryptJson(record.input),
      metadata: record.metadata ? this.encryptJson(record.metadata) : undefined
    };
    await this.store.createCase(encryptedRecord);
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    const record = await this.store.getCase(caseId);
    if (!record) return undefined;

    return {
      ...record,
      input: this.decryptJson(record.input),
      metadata: record.metadata ? this.decryptJson(record.metadata) : undefined
    };
  }

  async updateCaseMetadata(caseId: string, metadata: Record<string, unknown>): Promise<void> {
    const encryptedMetadata = this.encryptJson(metadata);
    await this.store.updateCaseMetadata(caseId, encryptedMetadata);
  }

  async addObservation(observation: Observation): Promise<void> {
    const encryptedObservation: Observation = {
      ...observation,
      message: this.encrypt(observation.message),
      data: observation.data ? this.encryptJson(observation.data) : undefined
    };
    await this.store.addObservation(encryptedObservation);
  }

  async getObservations(caseId: string): Promise<Observation[]> {
    const list = await this.store.getObservations(caseId);
    return list.map(item => ({
      ...item,
      message: this.decrypt(item.message),
      data: item.data ? this.decryptJson(item.data) : undefined
    }));
  }

  async addFinding(finding: Finding): Promise<void> {
    const encryptedFinding: Finding = {
      ...finding,
      description: this.encrypt(finding.description),
      evidence: finding.evidence ? this.encrypt(finding.evidence) : undefined,
      data: finding.data ? this.encryptJson(finding.data) : undefined
    };
    await this.store.addFinding(encryptedFinding);
  }

  async getFindings(caseId: string): Promise<Finding[]> {
    const list = await this.store.getFindings(caseId);
    return list.map(item => ({
      ...item,
      description: this.decrypt(item.description),
      evidence: item.evidence ? this.decrypt(item.evidence) : undefined,
      data: item.data ? this.decryptJson(item.data) : undefined
    }));
  }

  async searchSimilarFindings(queryText: string, limit: number = 5): Promise<Array<Finding & { score: number }>> {
    if (typeof (this.store as any).searchSimilarFindings === "function") {
      const results = await (this.store as any).searchSimilarFindings(queryText, limit);
      return results.map((item: any) => ({
        ...item,
        description: this.decrypt(item.description),
        evidence: item.evidence ? this.decrypt(item.evidence) : undefined,
        data: item.data ? this.decryptJson(item.data) : undefined
      }));
    }
    return [];
  }

  async appendExecutionRecord(caseId: string, record: ToolExecutionRecord): Promise<void> {
    const encryptedRecord = this.encryptExecutionRecord(record);
    await this.store.appendExecutionRecord(caseId, encryptedRecord);
  }

  async getExecutionHistory(caseId: string): Promise<ToolExecutionRecord[]> {
    const list = await this.store.getExecutionHistory(caseId);
    return list.map(item => this.decryptExecutionRecord(item));
  }

  async saveTrace(caseId: string, trace: ExecutionTrace): Promise<void> {
    const encryptedTrace: ExecutionTrace = {
      ...trace,
      toolExecutions: trace.toolExecutions.map(r => this.encryptExecutionRecord(r)),
      events: trace.events.map(ev => ({
        ...ev,
        payload: ev.payload ? this.encryptJson(ev.payload) : undefined
      }))
    };
    await this.store.saveTrace(caseId, encryptedTrace);
  }

  async getTrace(caseId: string): Promise<ExecutionTrace | undefined> {
    const trace = await this.store.getTrace(caseId);
    if (!trace) return undefined;

    return {
      ...trace,
      toolExecutions: trace.toolExecutions.map(r => this.decryptExecutionRecord(r)),
      events: trace.events.map(ev => ({
        ...ev,
        payload: ev.payload ? this.decryptJson(ev.payload) : undefined
      }))
    };
  }
}
