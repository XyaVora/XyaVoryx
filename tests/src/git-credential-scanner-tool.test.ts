import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { GitCredentialScannerTool } from "../../packages/tools/src/git-credential-scanner-tool";

describe("GitCredentialScannerTool", () => {
  it("detects Google API Key and redacted preview in files", async () => {
    const tempFile = path.resolve(process.cwd(), "temp-test-credential.txt");
    fs.writeFileSync(tempFile, "const apiKey = 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q';", "utf8");

    try {
      const output = await GitCredentialScannerTool.run({ scanPath: tempFile }, {} as never);
      expect(output.scannedFilesCount).toBe(1);
      expect(output.anomalies.length).toBe(1);
      expect(output.anomalies[0].type).toBe("Google API Key");
      expect(output.anomalies[0].preview).toBe("AIza...5P6Q");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("detects Generic Private Key begin signature", async () => {
    const tempFile = path.resolve(process.cwd(), "temp-test-key.txt");
    fs.writeFileSync(tempFile, "Some text before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQE...\n-----END RSA PRIVATE KEY-----", "utf8");

    try {
      const output = await GitCredentialScannerTool.run({ scanPath: tempFile }, {} as never);
      expect(output.anomalies.length).toBe(1);
      expect(output.anomalies[0].type).toBe("Generic Private Key");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
