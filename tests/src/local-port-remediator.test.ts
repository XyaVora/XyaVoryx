import { describe, expect, it } from "vitest";
import { LocalPortRemediator } from "../../packages/tools/src/local-port-remediator";

describe("LocalPortRemediator", () => {
  it("returns null for invalid port values", () => {
    expect(LocalPortRemediator.proposeRemediation(0)).toBeNull();
    expect(LocalPortRemediator.proposeRemediation(70000)).toBeNull();
    expect(LocalPortRemediator.proposeRemediation(Number.NaN as unknown as number)).toBeNull();
  });
});

