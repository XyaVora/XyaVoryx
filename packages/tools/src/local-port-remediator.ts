import { execSync } from "node:child_process";

export interface PortRemediationResult {
  port: number;
  pid: number | null;
  processInfo: string | null;
  diff: string;
  apply: () => Promise<void>;
}

export class LocalPortRemediator {
  static proposeRemediation(port: number): PortRemediationResult | null {
    const isWindows = process.platform === "win32";
    let pid: number | null = null;
    let processInfo: string | null = null;
    let diffLines: string[] = [];

    try {
      if (isWindows) {
        // Query netstat for listening TCP ports on the specified port
        const output = execSync("netstat -ano", { encoding: "utf8" });
        const lines = output.split(/\r?\n/);
        
        // Find line matching port, e.g. "  TCP    127.0.0.1:3306         0.0.0.0:0              LISTENING       1492"
        const portRegex = new RegExp(`TCP\\s+(?:[0-9.]+|\\[::\\]):${port}\\b.*LISTENING\\s+([0-9]+)`, "i");
        for (const line of lines) {
          const match = line.match(portRegex);
          if (match) {
            pid = parseInt(match[1], 10);
            break;
          }
        }

        if (pid) {
          // Query tasklist to get the name of the process
          try {
            const taskOutput = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8" });
            const trimmed = taskOutput.trim();
            if (trimmed && !trimmed.includes("No tasks")) {
              const parts = trimmed.split(/\s+/);
              processInfo = parts[0]; // Image Name, e.g. mysqld.exe
            }
          } catch (e) {
            // Ignore tasklist errors
          }
        }
      } else {
        // Unix/macOS: lsof -t -i :port
        try {
          const lsofOutput = execSync(`lsof -t -i :${port}`, { encoding: "utf8" }).trim();
          if (lsofOutput) {
            pid = parseInt(lsofOutput.split("\n")[0], 10);
          }
        } catch (e) {
          // Ignore lsof errors
        }

        if (pid) {
          try {
            processInfo = execSync(`ps -p ${pid} -o comm=`, { encoding: "utf8" }).trim();
          } catch (e) {
            // Ignore ps errors
          }
        }
      }
    } catch (err) {
      // Ignore system query errors
    }

    if (pid) {
      const name = processInfo ?? "Unknown Process";
      diffLines.push(`- Listening Port: TCP ${port}`);
      diffLines.push(`- Associated PID:  ${pid} (${name})`);
      diffLines.push(`[SYSTEM ACTIONS]`);
      diffLines.push(`+ Terminate process PID ${pid} to close TCP port ${port}`);

      return {
        port,
        pid,
        processInfo: name,
        diff: diffLines.join("\n"),
        apply: async () => {
          if (isWindows) {
            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          } else {
            execSync(`kill -9 ${pid}`, { stdio: "ignore" });
          }
        }
      };
    } else {
      // If PID cannot be found, provide manual remediation guidance
      diffLines.push(`- Listening Port: TCP ${port}`);
      diffLines.push(`[MANUAL MITIGATION REQUIRED]`);
      diffLines.push(`+ Identify the service binding to port ${port} and disable or reconfigure it to loopback-only binding.`);

      return {
        port,
        pid: null,
        processInfo: null,
        diff: diffLines.join("\n"),
        apply: async () => {
          // No-op for manual resolution
        }
      };
    }
  }
}
