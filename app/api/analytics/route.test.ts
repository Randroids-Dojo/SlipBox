import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const TEST_API_KEY = "sk-test-slipbox-key";

beforeEach(() => {
  process.env.SLIPBOX_API_KEY = TEST_API_KEY;
  process.env.GITHUB_TOKEN = "ghp_test_token";
  process.env.PRIVATEBOX_OWNER = "test-owner";
  process.env.PRIVATEBOX_REPO = "test-repo";
});

afterEach(() => {
  delete process.env.SLIPBOX_API_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.PRIVATEBOX_OWNER;
  delete process.env.PRIVATEBOX_REPO;
});

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function fakeGitHub404() {
  return {
    ok: false,
    status: 404,
    json: async () => ({ message: "Not Found" }),
    text: async () => "Not Found",
  } as unknown as Response;
}

function fakeGitHubContents(content: string, sha: string = "sha123") {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: encoded, sha, encoding: "base64" }),
    text: async () => "",
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const snapshot1 = {
  id: "snapshot-1000",
  capturedAt: "2026-02-21T00:00:00.000Z",
  noteCount: 5,
  linkCount: 3,
  clusterCount: 2,
  tensionCount: 1,
  decayCount: 0,
  clusterSizes: { "cluster-0": 3, "cluster-1": 2 },
  avgLinksPerNote: 1.2,
};

const snapshot2 = {
  id: "snapshot-2000",
  capturedAt: "2026-02-22T00:00:00.000Z",
  noteCount: 8,
  linkCount: 6,
  clusterCount: 3,
  tensionCount: 2,
  decayCount: 1,
  clusterSizes: { "cluster-0": 3, "cluster-1": 3, "cluster-2": 2 },
  avgLinksPerNote: 1.5,
};

const snapshot3 = {
  id: "snapshot-3000",
  capturedAt: "2026-02-23T00:00:00.000Z",
  noteCount: 10,
  linkCount: 9,
  clusterCount: 3,
  tensionCount: 3,
  decayCount: 2,
  clusterSizes: { "cluster-0": 4, "cluster-1": 3, "cluster-2": 3 },
  avgLinksPerNote: 1.8,
};

const snapshotsIndex = { snapshots: [snapshot1, snapshot2, snapshot3] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string = "http://localhost/api/analytics"): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/analytics", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/analytics", {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns empty snapshots array when no snapshots exist", async () => {
    fetchSpy.mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.snapshots).toEqual([]);
    expect(json.snapshotCount).toBe(0);
    expect(json.since).toBeUndefined();
  });

  it("returns all snapshots with deltas", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeGitHubContents(JSON.stringify(snapshotsIndex), "snap-sha"),
    );

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.snapshotCount).toBe(3);
    expect(json.snapshots).toHaveLength(3);

    // First snapshot has null delta
    expect(json.snapshots[0].delta).toBeNull();
    expect(json.snapshots[0].id).toBe("snapshot-1000");

    // Second snapshot has computed delta
    const delta2 = json.snapshots[1].delta;
    expect(delta2).not.toBeNull();
    expect(delta2.noteDelta).toBe(3); // 8 - 5
    expect(delta2.linkDelta).toBe(3); // 6 - 3
    expect(delta2.clusterDelta).toBe(1); // 3 - 2
    expect(delta2.tensionDelta).toBe(1); // 2 - 1
    expect(delta2.decayDelta).toBe(1); // 1 - 0

    // Third snapshot delta
    const delta3 = json.snapshots[2].delta;
    expect(delta3).not.toBeNull();
    expect(delta3.noteDelta).toBe(2); // 10 - 8
    expect(delta3.linkDelta).toBe(3); // 9 - 6
  });

  it("filters snapshots by since parameter", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeGitHubContents(JSON.stringify(snapshotsIndex), "snap-sha"),
    );

    const response = await GET(
      makeRequest("http://localhost/api/analytics?since=2026-02-22T00:00:00.000Z"),
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.snapshotCount).toBe(2);
    expect(json.snapshots[0].id).toBe("snapshot-2000");
    expect(json.snapshots[1].id).toBe("snapshot-3000");
    expect(json.since).toBe("2026-02-22T00:00:00.000Z");
  });

  it("returns first snapshot with null delta after filtering with since", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeGitHubContents(JSON.stringify(snapshotsIndex), "snap-sha"),
    );

    const response = await GET(
      makeRequest("http://localhost/api/analytics?since=2026-02-22"),
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    // First in filtered set always has null delta
    expect(json.snapshots[0].delta).toBeNull();
  });

  it("does not include since in response when not provided", async () => {
    fetchSpy.mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(Object.keys(json)).not.toContain("since");
  });

  it("includes since in response when provided", async () => {
    fetchSpy.mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(
      makeRequest("http://localhost/api/analytics?since=2026-01-01"),
    );
    const json = await response.json();

    expect(json.since).toBe("2026-01-01");
  });

  it("returns empty when since is after all snapshots", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeGitHubContents(JSON.stringify(snapshotsIndex), "snap-sha"),
    );

    const response = await GET(
      makeRequest("http://localhost/api/analytics?since=2030-01-01"),
    );
    const json = await response.json();

    expect(json.snapshots).toHaveLength(0);
    expect(json.snapshotCount).toBe(0);
  });

  it("preserves all snapshot fields in the response", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeGitHubContents(
        JSON.stringify({ snapshots: [snapshot1] }),
        "snap-sha",
      ),
    );

    const response = await GET(makeRequest());
    const json = await response.json();

    const snap = json.snapshots[0];
    expect(snap.id).toBe("snapshot-1000");
    expect(snap.capturedAt).toBe("2026-02-21T00:00:00.000Z");
    expect(snap.noteCount).toBe(5);
    expect(snap.linkCount).toBe(3);
    expect(snap.clusterCount).toBe(2);
    expect(snap.tensionCount).toBe(1);
    expect(snap.decayCount).toBe(0);
    expect(snap.clusterSizes).toEqual({ "cluster-0": 3, "cluster-1": 2 });
    expect(snap.avgLinksPerNote).toBe(1.2);
  });
});
