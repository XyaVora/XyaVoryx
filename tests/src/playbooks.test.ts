import { describe, expect, it } from "vitest";
import { PHISHING_PLAYBOOK, LOG_SECURITY_PLAYBOOK, PORT_SECURITY_PLAYBOOK } from "../../packages/sdk/src";

describe("Incident Playbook Registry", () => {
  it("should define a valid Phishing Playbook", () => {
    expect(PHISHING_PLAYBOOK.id).toBe("playbook-phishing");
    expect(PHISHING_PLAYBOOK.tools).toContain("email.header.analyzer");
    expect(PHISHING_PLAYBOOK.tools).toContain("ioc.extractor");
    expect(PHISHING_PLAYBOOK.workflow).toHaveLength(2);
  });

  it("should define a valid Log Security Playbook", () => {
    expect(LOG_SECURITY_PLAYBOOK.id).toBe("playbook-log-security");
    expect(LOG_SECURITY_PLAYBOOK.tools).toContain("log.security.parser");
    expect(LOG_SECURITY_PLAYBOOK.tools).toContain("ioc.extractor");
    expect(LOG_SECURITY_PLAYBOOK.workflow).toHaveLength(2);
  });

  it("should define a valid Port Security Playbook", () => {
    expect(PORT_SECURITY_PLAYBOOK.id).toBe("playbook-port-security");
    expect(PORT_SECURITY_PLAYBOOK.tools).toContain("local.port.analyzer");
    expect(PORT_SECURITY_PLAYBOOK.tools).toContain("local.port.remediator");
    expect(PORT_SECURITY_PLAYBOOK.workflow).toHaveLength(2);
  });
});
