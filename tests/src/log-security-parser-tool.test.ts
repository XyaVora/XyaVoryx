import { describe, expect, it } from "vitest";
import { LogSecurityParserTool } from "../../packages/tools/src/log-security-parser-tool";

describe("LogSecurityParserTool", () => {
  it("should auto-detect nginx logs and identify SQL injection, XSS, and Path Traversal", async () => {
    const logContent = `
127.0.0.1 - - [29/May/2026:23:45:01 +0700] "GET /index.php?id=1%27%20UNION%20SELECT%20null,username,password%20FROM%20users HTTP/1.1" 200 1024
127.0.0.1 - - [29/May/2026:23:45:02 +0700] "GET /search?q=%3Cscript%3Ealert(1)%3C/script%3E HTTP/1.1" 200 456
127.0.0.1 - - [29/May/2026:23:45:03 +0700] "GET /../../../../etc/passwd HTTP/1.1" 403 120
127.0.0.1 - - [29/May/2026:23:45:04 +0700] "GET /wp-login.php HTTP/1.1" 404 350
    `;

    const output = await LogSecurityParserTool.run({ logContent }, {} as never);

    expect(output.detectedType).toBe("nginx");
    expect(output.anomalies.length).toBe(4);

    expect(output.anomalies[0]).toEqual({
      type: "SQL Injection Pattern Detected",
      severity: "high",
      evidence: "127.0.0.1 - - [29/May/2026:23:45:01 +0700] \"GET /index.php?id=1%27%20UNION%20SELECT%20null,username,password%20FROM%20users HTTP/1.1\" 200 1024",
      cwe: ["CWE-89"],
      owasp: ["A03:2021-Injection"]
    });

    expect(output.anomalies[1]).toEqual({
      type: "Cross-Site Scripting (XSS) Pattern Detected",
      severity: "medium",
      evidence: "127.0.0.1 - - [29/May/2026:23:45:02 +0700] \"GET /search?q=%3Cscript%3Ealert(1)%3C/script%3E HTTP/1.1\" 200 456",
      cwe: ["CWE-79"],
      owasp: ["A03:2021-Injection"]
    });

    expect(output.anomalies[2]).toEqual({
      type: "Path Traversal / LFI Attempt",
      severity: "high",
      evidence: "127.0.0.1 - - [29/May/2026:23:45:03 +0700] \"GET /../../../../etc/passwd HTTP/1.1\" 403 120",
      cwe: ["CWE-22"],
      owasp: ["A01:2021-Broken Access Control"]
    });

    expect(output.anomalies[3]).toEqual({
      type: "Web Scanning or Unauthorized Access Attempt",
      severity: "medium",
      evidence: "127.0.0.1 - - [29/May/2026:23:45:04 +0700] \"GET /wp-login.php HTTP/1.1\" 404 350",
      cwe: ["CWE-307", "CWE-200"],
      owasp: ["A07:2021-Identification and Authentication Failures"]
    });
  });

  it("should auto-detect syslog and identify SSH failed passwords and sudo auth failures", async () => {
    const logContent = `
May 29 23:45:01 mail sshd[12345]: Failed password for invalid user admin from 192.168.1.100 port 55662 ssh2
May 29 23:45:02 mail sudo: pam_unix(sudo:auth): authentication failure; logname=alice uid=1001 euid=0 tty=/dev/pts/1 ruser=alice rhost=  user=alice
May 29 23:45:03 mail cron[2233]: (root) CMD (   /usr/local/bin/backup.sh)
    `;

    const output = await LogSecurityParserTool.run({ logContent }, {} as never);

    expect(output.detectedType).toBe("syslog");
    expect(output.anomalies.length).toBe(2);

    expect(output.anomalies[0]).toEqual({
      type: "Failed System Login Attempt",
      severity: "medium",
      evidence: "May 29 23:45:01 mail sshd[12345]: Failed password for invalid user admin from 192.168.1.100 port 55662 ssh2",
      cwe: ["CWE-307"],
      owasp: ["A07:2021-Identification and Authentication Failures"]
    });

    expect(output.anomalies[1]).toEqual({
      type: "Unauthorized Privilege Escalation Attempt (sudo)",
      severity: "high",
      evidence: "May 29 23:45:02 mail sudo: pam_unix(sudo:auth): authentication failure; logname=alice uid=1001 euid=0 tty=/dev/pts/1 ruser=alice rhost=  user=alice",
      cwe: ["CWE-269"],
      owasp: ["A01:2021-Broken Access Control"]
    });
  });

  it("should auto-detect Windows logs and identify login failures and lockouts", async () => {
    const logContent = `
2026-05-29 23:45:01, Security-Auditing, EventID: 4625, An account failed to log on. Subject: Security ID: SYSTEM, Account Name: MAIL$, Account Domain: WORKGROUP.
2026-05-29 23:45:02, Security-Auditing, EventID: 4740, A user account was locked out. Account Name: bob, Subject: Account Domain: WORKGROUP.
    `;

    const output = await LogSecurityParserTool.run({ logContent }, {} as never);

    expect(output.detectedType).toBe("windows");
    expect(output.anomalies.length).toBe(2);

    expect(output.anomalies[0]).toEqual({
      type: "Windows Account Logon Failure (Event 4625)",
      severity: "medium",
      evidence: "2026-05-29 23:45:01, Security-Auditing, EventID: 4625, An account failed to log on. Subject: Security ID: SYSTEM, Account Name: MAIL$, Account Domain: WORKGROUP.",
      cwe: ["CWE-307"],
      owasp: ["A07:2021-Identification and Authentication Failures"]
    });

    expect(output.anomalies[1]).toEqual({
      type: "Windows User Account Lockout Event (Event 4740)",
      severity: "high",
      evidence: "2026-05-29 23:45:02, Security-Auditing, EventID: 4740, A user account was locked out. Account Name: bob, Subject: Account Domain: WORKGROUP.",
      cwe: ["CWE-307"],
      owasp: ["A07:2021-Identification and Authentication Failures"]
    });
  });
});
