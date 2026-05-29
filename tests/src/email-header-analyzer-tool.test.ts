import { describe, expect, it } from "vitest";
import { EmailHeaderAnalyzerTool } from "../../packages/tools/src/email-header-analyzer-tool";

describe("EmailHeaderAnalyzerTool", () => {
  it("parses headers and flags suspicious authentication", async () => {
    const rawEmail = [
      "From: Billing <billing@contoso-payments.com>",
      "To: user@contoso.com",
      "Subject: Urgent invoice payment",
      "Return-Path: <mailer@another-domain.net>",
      "Received: from smtp.attacker.net by mx.contoso.com",
      "Authentication-Results: mx.contoso.com; spf=fail; dkim=none; dmarc=fail",
      "",
      "Body"
    ].join("\n");

    const output = await EmailHeaderAnalyzerTool.run({ rawEmail }, {} as never);

    expect(output.from).toContain("billing@contoso-payments.com");
    expect(output.receivedChain).toHaveLength(1);
    expect(output.authentication.spf).toBe("fail");
    expect(output.risks.length).toBeGreaterThan(0);
    expect(output.risks).toContain("From domain and Return-Path domain mismatch");
  });
});