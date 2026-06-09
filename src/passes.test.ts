import { describe, expect, it } from "vitest";
import {
  setupTestEnv,
  setupFetchSpy,
  fakeGitHub404,
  fakeGitHubContents,
  fakeGitHubPut,
} from "../app/api/__test-setup__";
import {
  runLinkPass,
  runClusterPass,
  runTensionPass,
  runFullCycle,
  PassValidationError,
  PassPreconditionError,
} from "./passes";

setupTestEnv();
const fetchSpy = setupFetchSpy();

/** A small embeddings index with `n` 3-dim notes. */
function embeddings(n: number) {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    out[`note-${i}`] = {
      noteId: `note-${i}`,
      vector: [i, i % 2, 1],
      model: "m",
      createdAt: "t",
    };
  }
  return { embeddings: out };
}

describe("runLinkPass", () => {
  it("returns no-notes early when the graph is empty", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHub404()) // read embeddings
      .mockResolvedValueOnce(fakeGitHub404()); // read backlinks

    const result = await runLinkPass();
    expect(result).toEqual({ message: "No notes to link", totalLinks: 0 });
  });
});

describe("runClusterPass", () => {
  it("throws PassValidationError on an invalid k (before any fetch)", async () => {
    await expect(runClusterPass({ k: 1 })).rejects.toBeInstanceOf(
      PassValidationError,
    );
  });
});

describe("runTensionPass", () => {
  it("throws PassPreconditionError when there are notes but no clusters", async () => {
    // 4 notes (>= MIN_NOTES_FOR_TENSION) but clusters/tensions are empty.
    fetchSpy.spy.mockImplementation((url: unknown) => {
      if (String(url).includes("embeddings.json")) {
        return Promise.resolve(
          fakeGitHubContents(JSON.stringify(embeddings(4))),
        );
      }
      return Promise.resolve(fakeGitHub404());
    });

    await expect(runTensionPass()).rejects.toBeInstanceOf(
      PassPreconditionError,
    );
  });
});

describe("runFullCycle", () => {
  it("runs every pass in order and records tension as skipped when no clusters persist", async () => {
    // embeddings.json read returns 4 notes; every other read is empty (404);
    // every write succeeds. Cluster-pass computes clusters, but the persisted
    // clusters read inside tension-pass stays empty, so tension is skipped.
    fetchSpy.spy.mockImplementation((url: unknown, init: unknown) => {
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PUT") return Promise.resolve(fakeGitHubPut());
      if (String(url).includes("embeddings.json")) {
        return Promise.resolve(
          fakeGitHubContents(JSON.stringify(embeddings(4))),
        );
      }
      return Promise.resolve(fakeGitHub404());
    });

    const result = await runFullCycle();
    const names = result.steps.map((s) => s.name);
    expect(names).toEqual([
      "link-pass",
      "cluster-pass",
      "tension-pass",
      "decay-pass",
      "exploration-pass",
      "snapshot",
    ]);
    expect(result.steps.every((s) => s.ok)).toBe(true);

    const tension = result.steps.find((s) => s.name === "tension-pass");
    expect(tension?.skipped).toBeTruthy();
  });
});
