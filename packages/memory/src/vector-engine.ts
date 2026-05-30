import type { Finding } from "@xyavoryx/core";

// 64-dimensional semantic security keyword vocabulary space
const SECURITY_KEYWORDS = [
  "credential", "api", "key", "password", "token", "secret", "private", "leak", "exposed", "hardcoded",
  "docker", "compose", "container", "privileged", "network", "host", "port", "database", "mysql", "postgres",
  "listening", "open", "insecure", "unencrypted", "cwe", "owasp", "vulnerability", "risk", "severity", "audit",
  "mitigation", "remediate", "fix", "patch", "evidence", "line", "file", "path", "command", "shell",
  "broken", "access", "control", "spf", "dkim", "dmarc", "spoof", "phishing", "email", "header",
  "stacktrace", "test", "fail", "error", "exception", "failure", "signature", "jwt", "cors", "ssrf",
  "injection", "traverse", "weak", "auth"
];

// Stemming helper to handle plurals, past tense and other common variations
function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.endsWith("s") && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  return w;
}

const STEMMED_SECURITY_KEYWORDS = SECURITY_KEYWORDS.map(stem);

export class VectorEngine {
  // Tokenize and clean text into lowercase words
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter(w => w.length > 0);
  }

  // Compute a dense 64-dimensional normalized vector for a generic text search query
  static computeQueryVector(queryText: string): number[] {
    const tokens = this.tokenize(queryText);
    const vector = new Array(SECURITY_KEYWORDS.length).fill(0);

    for (const token of tokens) {
      const idx = STEMMED_SECURITY_KEYWORDS.indexOf(stem(token));
      if (idx !== -1) {
        vector[idx] += 1;
      }
    }

    // Apply sub-linear scaling TF weights: 1 + ln(count) for term matches
    for (let i = 0; i < vector.length; i++) {
      if (vector[i] > 0) {
        vector[i] = 1 + Math.log(vector[i]);
      }
    }

    return this.normalize(vector);
  }

  // Compute a dense 64-dimensional normalized vector representing a Finding model
  static computeVector(finding: Finding): number[] {
    // Combine text fields for standard tokenization
    const textField = [
      finding.title,
      finding.description,
      finding.sourceTool ?? "",
      finding.evidence ?? ""
    ].join(" ");

    const tokens = this.tokenize(textField);
    const vector = new Array(SECURITY_KEYWORDS.length).fill(0);

    // 1. Accumulate direct term frequency counts
    for (const token of tokens) {
      const idx = STEMMED_SECURITY_KEYWORDS.indexOf(stem(token));
      if (idx !== -1) {
        vector[idx] += 1;
      }
    }

    // 2. Inject explicit high-fidelity semantic weights for structured fields
    // severity weights
    if (finding.severity === "high") {
      vector[SECURITY_KEYWORDS.indexOf("severity")] += 5;
      vector[SECURITY_KEYWORDS.indexOf("vulnerability")] += 3;
      vector[SECURITY_KEYWORDS.indexOf("risk")] += 3;
    } else if (finding.severity === "medium") {
      vector[SECURITY_KEYWORDS.indexOf("severity")] += 2;
      vector[SECURITY_KEYWORDS.indexOf("vulnerability")] += 1.5;
      vector[SECURITY_KEYWORDS.indexOf("risk")] += 1.5;
    }

    // CWE weights
    if (finding.cwe) {
      vector[SECURITY_KEYWORDS.indexOf("cwe")] += 5;
      vector[SECURITY_KEYWORDS.indexOf("vulnerability")] += 2;
      if (finding.cwe.includes("798")) {
        vector[SECURITY_KEYWORDS.indexOf("credential")] += 4;
        vector[SECURITY_KEYWORDS.indexOf("key")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("secret")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("hardcoded")] += 4;
      } else if (finding.cwe.includes("250")) {
        vector[SECURITY_KEYWORDS.indexOf("privileged")] += 4;
        vector[SECURITY_KEYWORDS.indexOf("access")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("control")] += 3;
      } else if (finding.cwe.includes("668")) {
        vector[SECURITY_KEYWORDS.indexOf("network")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("host")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("port")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("exposed")] += 3;
      }
    }

    // OWASP weights
    if (finding.owasp) {
      vector[SECURITY_KEYWORDS.indexOf("owasp")] += 5;
      if (finding.owasp.toLowerCase().includes("auth") || finding.owasp.includes("A07")) {
        vector[SECURITY_KEYWORDS.indexOf("auth")] += 4;
        vector[SECURITY_KEYWORDS.indexOf("credential")] += 3;
      } else if (finding.owasp.toLowerCase().includes("access") || finding.owasp.includes("A01")) {
        vector[SECURITY_KEYWORDS.indexOf("access")] += 4;
        vector[SECURITY_KEYWORDS.indexOf("control")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("broken")] += 3;
      } else if (finding.owasp.toLowerCase().includes("config") || finding.owasp.includes("A05")) {
        vector[SECURITY_KEYWORDS.indexOf("insecure")] += 3;
        vector[SECURITY_KEYWORDS.indexOf("audit")] += 2;
      }
    }

    // Source tool specific boosts
    if (finding.sourceTool === "git.credential.scanner") {
      vector[SECURITY_KEYWORDS.indexOf("credential")] += 4;
      vector[SECURITY_KEYWORDS.indexOf("leak")] += 3;
      vector[SECURITY_KEYWORDS.indexOf("exposed")] += 3;
    } else if (finding.sourceTool === "docker.auditor") {
      vector[SECURITY_KEYWORDS.indexOf("docker")] += 4;
      vector[SECURITY_KEYWORDS.indexOf("compose")] += 4;
      vector[SECURITY_KEYWORDS.indexOf("container")] += 3;
    } else if (finding.sourceTool === "local.port.analyzer") {
      vector[SECURITY_KEYWORDS.indexOf("port")] += 4;
      vector[SECURITY_KEYWORDS.indexOf("listening")] += 3;
      vector[SECURITY_KEYWORDS.indexOf("network")] += 3;
    }

    // 3. Apply logarithmic sub-linear term scaling: 1 + ln(tf)
    for (let i = 0; i < vector.length; i++) {
      if (vector[i] > 0) {
        vector[i] = 1 + Math.log(vector[i]);
      }
    }

    return this.normalize(vector);
  }

  // Compute cosine similarity between two unit-normalized vectors: vecA . vecB
  static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct; // Since vectors are normalized, dot product is exactly the cosine similarity
  }

  // Normalize a vector to unit length (L2 norm)
  private static normalize(vector: number[]): number[] {
    let sumSq = 0;
    for (const val of vector) {
      sumSq += val * val;
    }

    const magnitude = Math.sqrt(sumSq);
    if (magnitude === 0) {
      return new Array(vector.length).fill(0);
    }

    return vector.map(val => val / magnitude);
  }
}
