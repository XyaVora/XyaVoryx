import { z } from "zod";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  rawEmail: z.string()
});

export interface EmailHeaderAnalyzerOutput {
  from?: string;
  to?: string[];
  subject?: string;
  receivedChain: string[];
  authentication: {
    spf?: string;
    dkim?: string;
    dmarc?: string;
  };
  risks: string[];
}

function parseHeaderLines(rawEmail: string): string[] {
  const normalized = rawEmail.replace(/\r\n/g, "\n");
  const headerText = normalized.split("\n\n")[0] ?? "";
  const lines = headerText.split("\n");
  const merged: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && merged.length > 0) {
      merged[merged.length - 1] += ` ${line.trim()}`;
    } else if (line.trim().length > 0) {
      merged.push(line.trim());
    }
  }

  return merged;
}

function headerMap(lines: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
  }

  return map;
}

function parseAuthField(authResult: string, field: "spf" | "dkim" | "dmarc"): string | undefined {
  const pattern = new RegExp(`${field}=([a-zA-Z0-9_-]+)`, "i");
  const match = authResult.match(pattern);
  return match?.[1]?.toLowerCase();
}

function firstHeader(map: Map<string, string[]>, key: string): string | undefined {
  return map.get(key)?.[0];
}

function parseAddressList(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const addresses = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return addresses.length > 0 ? addresses : undefined;
}

function extractDomain(address?: string): string | undefined {
  if (!address) {
    return undefined;
  }

  const match = address.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match?.[1]?.toLowerCase();
}

function isAuthFailure(value?: string): boolean {
  if (!value) {
    return true;
  }

  return ["fail", "softfail", "none", "neutral", "temperror", "permerror"].includes(value.toLowerCase());
}

export const EmailHeaderAnalyzerTool: XyaVoryxTool<z.infer<typeof inputSchema>, EmailHeaderAnalyzerOutput> = {
  name: "email.header.analyzer",
  description: "Analyze raw email headers for suspicious signals.",
  inputSchema,
  metadata: {
    tags: ["email", "header", "phishing"],
    capabilities: ["parse-header", "detect-auth-risk"],
    riskLevel: "low",
    requiresNetwork: false,
    requiresFilesystem: false
  },
  async run(input) {
    const lines = parseHeaderLines(input.rawEmail);
    const map = headerMap(lines);

    const from = firstHeader(map, "from");
    const to = parseAddressList(firstHeader(map, "to"));
    const subject = firstHeader(map, "subject");
    const receivedChain = map.get("received") ?? [];

    const authResults = (map.get("authentication-results") ?? []).join("; ");
    const receivedSpf = firstHeader(map, "received-spf");

    const spf = parseAuthField(authResults, "spf") ?? receivedSpf?.split(" ")?.[0]?.toLowerCase();
    const dkim = parseAuthField(authResults, "dkim");
    const dmarc = parseAuthField(authResults, "dmarc");

    const risks: string[] = [];

    if (!from) {
      risks.push("Missing From header");
    }

    if (receivedChain.length === 0) {
      risks.push("No Received chain present");
    }

    if (isAuthFailure(spf)) {
      risks.push("SPF authentication is missing or failed");
    }

    if (isAuthFailure(dkim)) {
      risks.push("DKIM authentication is missing or failed");
    }

    if (isAuthFailure(dmarc)) {
      risks.push("DMARC authentication is missing or failed");
    }

    if (subject && /urgent|verify|password|payment|invoice|reset/i.test(subject)) {
      risks.push("Suspicious subject keyword detected");
    }

    const returnPath = firstHeader(map, "return-path");
    const fromDomain = extractDomain(from);
    const returnPathDomain = extractDomain(returnPath);
    if (fromDomain && returnPathDomain && fromDomain !== returnPathDomain) {
      risks.push("From domain and Return-Path domain mismatch");
    }

    return {
      from,
      to,
      subject,
      receivedChain,
      authentication: {
        spf,
        dkim,
        dmarc
      },
      risks
    };
  }
};