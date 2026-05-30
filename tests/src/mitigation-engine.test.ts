import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MitigationEngine } from "../../packages/tools/src/mitigation-engine";
import type { Finding } from "../../packages/core/src";

describe("MitigationEngine", () => {
  it("proposes privileged container docker-compose remediation successfully", async () => {
    const tempDir = path.resolve(process.cwd(), "temp-test-compose-dir-1");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const composeFile = path.join(tempDir, "docker-compose.yml");
    fs.writeFileSync(composeFile, "services:\n  web:\n    image: nginx\n    privileged: true", "utf8");

    const finding: Finding = {
      id: "f-compose-1",
      sessionId: "s-1",
      caseId: "c-1",
      title: "Privileged Container Privilege Abuse Risk [web]",
      severity: "high",
      description: "Privileged container active",
      sourceTool: "docker.auditor",
      evidence: "Line 4: privileged: true",
      createdAt: new Date().toISOString()
    };

    try {
      const proposal = MitigationEngine.proposeFix(finding, tempDir);
      expect(proposal).toBeDefined();
      expect(proposal?.diff).toContain("- privileged: true");
      expect(proposal?.diff).toContain("+ privileged: false");

      // Apply the fix
      await proposal?.apply();
      const updatedContent = fs.readFileSync(composeFile, "utf8");
      expect(updatedContent).toContain("privileged: false");
    } finally {
      if (fs.existsSync(composeFile)) fs.unlinkSync(composeFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });

  it("proposes credentials isolation docker-compose remediation successfully", async () => {
    const tempDir = path.resolve(process.cwd(), "temp-test-compose-dir-2");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const composeFile = path.join(tempDir, "docker-compose.yml");
    fs.writeFileSync(composeFile, "services:\n  db:\n    image: mysql\n    MYSQL_ROOT_PASSWORD: supersecretpassword", "utf8");

    const finding: Finding = {
      id: "f-compose-2",
      sessionId: "s-1",
      caseId: "c-1",
      title: "Insecure Cleartext Hardcoded Secrets [db]",
      severity: "medium",
      description: "Hardcoded MySQL password found",
      sourceTool: "docker.auditor",
      evidence: "Line 4: MYSQL_ROOT_PASSWORD: supersecretpassword",
      createdAt: new Date().toISOString()
    };

    const envFile = path.join(tempDir, ".env");
    const exampleFile = path.join(tempDir, ".env.example");

    try {
      const proposal = MitigationEngine.proposeFix(finding, tempDir);
      expect(proposal).toBeDefined();
      expect(proposal?.diff).toContain("- MYSQL_ROOT_PASSWORD: supersecretpassword");
      expect(proposal?.diff).toContain("+ MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}");

      // Apply the fix
      await proposal?.apply();
      
      const updatedContent = fs.readFileSync(composeFile, "utf8");
      expect(updatedContent).toContain("MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}");

      expect(fs.existsSync(envFile)).toBe(true);
      const envContent = fs.readFileSync(envFile, "utf8");
      expect(envContent).toContain("MYSQL_ROOT_PASSWORD=supersecretpassword");

      expect(fs.existsSync(exampleFile)).toBe(true);
      const exampleContent = fs.readFileSync(exampleFile, "utf8");
      expect(exampleContent).toContain("MYSQL_ROOT_PASSWORD=");
    } finally {
      if (fs.existsSync(composeFile)) fs.unlinkSync(composeFile);
      if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
      if (fs.existsSync(exampleFile)) fs.unlinkSync(exampleFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });

  it("handles local port mitigation proposal smoothly", async () => {
    const finding: Finding = {
      id: "f-port-1",
      sessionId: "s-1",
      caseId: "c-1",
      title: "Insecure open port detected: 3306 (MySQL Database)",
      severity: "medium",
      description: "MySQL listening locally",
      sourceTool: "local.port.analyzer",
      createdAt: new Date().toISOString()
    };

    const proposal = MitigationEngine.proposeFix(finding);
    expect(proposal).toBeDefined();
    expect(proposal?.diff).toContain("Listening Port: TCP 3306");
  });
});
