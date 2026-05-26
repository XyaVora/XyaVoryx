import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMemoryStore } from "../../packages/memory/src/file-memory-store";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xyavoryx-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("FileMemoryStore", () => {
  it("persists session/case/finding data and reloads across instances", async () => {
    const dir = await createTempDir();
    const store = new FileMemoryStore({ baseDir: dir });

    await store.createSession({
      id: "session-1",
      agentName: "Agent",
      task: "Task",
      status: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    await store.createCase({
      id: "case-1",
      sessionId: "session-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      input: {
        task: "Task",
        rawInput: "raw"
      }
    });

    await store.addFinding({
      id: "finding-1",
      caseId: "case-1",
      sessionId: "session-1",
      title: "Indicator",
      severity: "medium",
      description: "desc",
      sourceTool: "ioc.extractor",
      createdAt: "2026-01-01T00:00:00.000Z",
      data: {
        key: "value"
      }
    });

    const reloaded = new FileMemoryStore({ baseDir: dir });
    expect((await reloaded.getSession("session-1"))?.agentName).toBe("Agent");
    expect((await reloaded.getCase("case-1"))?.input.rawInput).toBe("raw");
    expect((await reloaded.getFindings("case-1"))[0]?.title).toBe("Indicator");
  });

  it("writes deterministic state file with sorted top-level keys", async () => {
    const dir = await createTempDir();
    const store = new FileMemoryStore({ baseDir: dir });

    await store.createSession({
      id: "session-b",
      agentName: "Agent B",
      task: "Task",
      status: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await store.createSession({
      id: "session-a",
      agentName: "Agent A",
      task: "Task",
      status: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const statePath = join(dir, "state.json");
    const text = await readFile(statePath, "utf8");
    const parsed = JSON.parse(text) as { sessions: Record<string, unknown> };
    expect(Object.keys(parsed.sessions)).toEqual(["session-a", "session-b"]);
  });
});
