import { z } from "zod";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  text: z.string()
});

export interface IOCExtractorOutput {
  ips: string[];
  domains: string[];
  urls: string[];
  emails: string[];
  hashes: {
    md5: string[];
    sha1: string[];
    sha256: string[];
  };
  cves: string[];
  filePaths: string[];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function collect(text: string, pattern: RegExp, groupIndex = 0): string[] {
  const matches: string[] = [];

  for (const match of text.matchAll(pattern)) {
    const raw = match[groupIndex] ?? match[0];
    if (raw) {
      matches.push(raw);
    }
  }

  return unique(matches);
}

export const IOCExtractorTool: XyaVoryxTool<z.infer<typeof inputSchema>, IOCExtractorOutput> = {
  name: "ioc.extractor",
  description: "Extract indicators of compromise from raw text.",
  inputSchema,
  metadata: {
    tags: ["ioc", "parser", "security"],
    capabilities: ["extract-ip", "extract-domain", "extract-hash"],
    riskLevel: "low",
    requiresNetwork: false,
    requiresFilesystem: false
  },
  async run(input) {
    const text = input.text;

    const ips = collect(text, /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g);
    const urls = collect(text, /\bhttps?:\/\/[\w.-]+(?:\:[0-9]+)?(?:\/[\w\-.~:/?#[\]@!$&'()*+,;=%]*)?/gi);
    const emails = collect(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
    const domains = collect(text, /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g)
      .filter((domain) => !ips.includes(domain));

    const md5 = collect(text, /\b[a-fA-F0-9]{32}\b/g);
    const sha1 = collect(text, /\b[a-fA-F0-9]{40}\b/g);
    const sha256 = collect(text, /\b[a-fA-F0-9]{64}\b/g);

    const cves = collect(text, /\bCVE-\d{4}-\d{4,7}\b/gi)
      .map((value) => value.toUpperCase());

    const windowsPaths = collect(text, /\b[A-Za-z]:\\(?:[^\\\r\n\t:*?"<>|]+\\)*[^\\\r\n\t:*?"<>|]+\b/g);
    const unixPaths = collect(text, /(?:^|\s)(\/(?:[^\s\/]+\/)*[^\s\/]+)/g, 1);
    const filePaths = unique([...windowsPaths, ...unixPaths]);

    return {
      ips,
      domains,
      urls,
      emails,
      hashes: {
        md5,
        sha1,
        sha256
      },
      cves: unique(cves),
      filePaths
    };
  }
};