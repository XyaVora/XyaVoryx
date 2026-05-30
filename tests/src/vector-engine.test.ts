import { describe, expect, it } from "vitest";
import { VectorEngine } from "../../packages/memory/src/vector-engine";
import type { Finding } from "../../packages/core/src";

describe("VectorEngine", () => {
  it("computes query vectors and unit normalizes them correctly", () => {
    const vec1 = VectorEngine.computeQueryVector("mysql password credential");
    const vec2 = VectorEngine.computeQueryVector("docker privileged compose");

    expect(vec1.length).toBe(64);
    expect(vec2.length).toBe(64);

    // Verifies unit normalization (L2 norm should be extremely close to 1)
    let sumSq = 0;
    for (const val of vec1) sumSq += val * val;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 4);
  });

  it("evaluates cosine similarity accurately between vectors", () => {
    const vecA = VectorEngine.computeQueryVector("credential password");
    const vecB = VectorEngine.computeQueryVector("credential password keys");
    const vecC = VectorEngine.computeQueryVector("docker container host");

    const simAB = VectorEngine.cosineSimilarity(vecA, vecB);
    const simAC = VectorEngine.cosineSimilarity(vecA, vecC);

    expect(simAB).toBeGreaterThan(0.5); // Highly related
    expect(simAC).toBeCloseTo(0, 4); // Completely unrelated
  });

  it("calculates dense vectors for Findings using explicit security boosts", () => {
    const finding: Finding = {
      id: "f-1",
      sessionId: "s-1",
      caseId: "c-1",
      title: "Hardcoded API key leaked",
      severity: "high",
      description: "Found credentials in workspace source files",
      sourceTool: "git.credential.scanner",
      cwe: "CWE-798",
      createdAt: new Date().toISOString()
    };

    const vec = VectorEngine.computeVector(finding);
    expect(vec.length).toBe(64);

    // Verify L2 norm is 1
    let sumSq = 0;
    for (const val of vec) sumSq += val * val;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 4);

    // Verify key indices (credential, api, key, severity) have high values due to explicit boosts
    // "credential" is first (index 0)
    // "api" is second (index 1)
    // "key" is third (index 2)
    // "severity" is 28th (index 28)
    expect(vec[0]).toBeGreaterThan(0.1);
    expect(vec[1]).toBeGreaterThan(0.1);
    expect(vec[2]).toBeGreaterThan(0.1);
  });
});
