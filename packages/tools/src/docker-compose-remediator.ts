import * as fs from "node:fs";
import * as path from "node:path";

export interface ComposePatchResult {
  patchedFile: string;
  diff: string;
  apply: () => Promise<void>;
}

export class DockerComposeRemediator {
  static proposeRemediation(
    findingTitle: string,
    evidenceLineText: string,
    customPath?: string
  ): ComposePatchResult | null {
    const searchPath = customPath ?? process.cwd();
    let targetFilePath = "";

    if (fs.existsSync(searchPath)) {
      const stat = fs.statSync(searchPath);
      if (stat.isFile()) {
        targetFilePath = searchPath;
      } else if (stat.isDirectory()) {
        const candidates = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
        for (const cand of candidates) {
          const check = path.join(searchPath, cand);
          if (fs.existsSync(check)) {
            targetFilePath = check;
            break;
          }
        }
      }
    }

    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      return null;
    }

    const content = fs.readFileSync(targetFilePath, "utf8");
    const rawLines = content.split(/\r?\n/);
    const modifiedLines = [...rawLines];

    let patchApplied = false;
    let diffLines: string[] = [];

    // Parse the target evidence line index out of the finding evidence
    const lineIndexMatch = evidenceLineText.match(/Line\s+([0-9]+)/i);
    const targetIdx = lineIndexMatch ? parseInt(lineIndexMatch[1], 10) - 1 : -1;

    // A. Privileged container remediation
    if (findingTitle.includes("Privileged Container") && targetIdx !== -1 && targetIdx < rawLines.length) {
      const targetLine = rawLines[targetIdx];
      if (/privileged\s*:\s*true/i.test(targetLine)) {
        const replacement = targetLine.replace(/privileged\s*:\s*true/i, "privileged: false");
        modifiedLines[targetIdx] = replacement;
        patchApplied = true;
        diffLines.push(`- ${targetLine.trim()}`);
        diffLines.push(`+ ${replacement.trim()}`);
      }
    }

    // B. Public database port exposure remediation
    if (findingTitle.includes("Public Database Port Exposure") && targetIdx !== -1 && targetIdx < rawLines.length) {
      const targetLine = rawLines[targetIdx];
      const portMatch = targetLine.match(/(?:-\s*["']?|["']?)([0-9]+):([0-9]+)["']?/);
      if (portMatch) {
        // Prepend localhost binding 127.0.0.1:
        const replacement = targetLine.replace(portMatch[0], `127.0.0.1:${portMatch[0]}`);
        modifiedLines[targetIdx] = replacement;
        patchApplied = true;
        diffLines.push(`- ${targetLine.trim()}`);
        diffLines.push(`+ ${replacement.trim()}`);
      }
    }

    // C. Environment variables cleartext credentials isolation
    if (findingTitle.includes("Insecure Cleartext Hardcoded Secrets") && targetIdx !== -1 && targetIdx < rawLines.length) {
      const targetLine = rawLines[targetIdx];
      const envMatch = targetLine.match(/(?:PASSWORD|SECRET|DB_PASS|PASSWD)\s*[:=]\s*(.+)/i);
      if (envMatch) {
        let val = envMatch[1].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1).trim();
        }

        // Get key name, e.g. MYSQL_ROOT_PASSWORD
        const keyMatch = targetLine.match(/^(\s*)([a-zA-Z0-9_-]+)\s*[:=]/);
        if (keyMatch && val && !val.includes("${") && !val.startsWith("$")) {
          const indent = keyMatch[1];
          const keyName = keyMatch[2];
          
          // Generate replacement line using docker environment variable variable mapping ${VAR}
          const replacement = `${indent}${keyName}: \${${keyName}}`;
          modifiedLines[targetIdx] = replacement;
          patchApplied = true;
          
          diffLines.push(`- ${targetLine.trim()}`);
          diffLines.push(`+ ${replacement.trim()}`);
          diffLines.push(`[SYSTEM ACTIONS]`);
          diffLines.push(`+ Append to .env:      ${keyName}=${val}`);
          diffLines.push(`+ Append to .env.example: ${keyName}=`);

          return {
            patchedFile: path.basename(targetFilePath),
            diff: diffLines.join("\n"),
            apply: async () => {
              // 1. Write the compose file replacement
              fs.writeFileSync(targetFilePath, modifiedLines.join("\n"), "utf8");

              // 2. Append to secure .env file
              const envPath = path.resolve(path.dirname(targetFilePath), ".env");
              let envContent = "";
              if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, "utf8").trim() + "\n";
              }
              if (!envContent.includes(`${keyName}=`)) {
                envContent += `${keyName}=${val}\n`;
                fs.writeFileSync(envPath, envContent, "utf8");
              }

              // 3. Append placeholder to .env.example
              const examplePath = path.resolve(path.dirname(targetFilePath), ".env.example");
              let exampleContent = "";
              if (fs.existsSync(examplePath)) {
                exampleContent = fs.readFileSync(examplePath, "utf8").trim() + "\n";
              }
              if (!exampleContent.includes(`${keyName}=`)) {
                exampleContent += `${keyName}=\n`;
                fs.writeFileSync(examplePath, exampleContent, "utf8");
              }
            }
          };
        }
      }
    }

    if (!patchApplied) {
      return null;
    }

    return {
      patchedFile: path.basename(targetFilePath),
      diff: diffLines.join("\n"),
      apply: async () => {
        fs.writeFileSync(targetFilePath, modifiedLines.join("\n"), "utf8");
      }
    };
  }
}
