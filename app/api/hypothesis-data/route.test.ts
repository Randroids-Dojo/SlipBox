import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  TEST_API_KEY,
  setupTestEnv,
  setupFetchSpy,
  fakeGitHub404,
  fakeGitHubContents,
} from "../__test-setup__";
import { GET } from "./route";

setupTestEnv();
const fetchSpy = setupFetchSpy();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest() {
  return new NextRequest("http://localhost/api/hypothesis-data", {
    method: "GET",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

const NOTE_A = "20260101T000000-aaaaaaaa";
const NOTE_B = "20260101T000001-bbbbbbbb";
const NOTE_C = "20260101T000002-cccccccc";

const TENSIONS = {
  tensions: {
    "tension-0": {
      id: "tension-0",
      noteA: NOTE_A,
      noteB: NOTE_B,
      similarity: 0.62,
      clusterId: "cluster-0",
      detectedAt: "2026-01-01T00:00:00Z",
    },
  },
  computedAt: "2026-01-01T00:00:00Z",
};

const CLUSTERS = {
  clusters: {
    "cluster-0": {
      id: "cluster-0",
      centroid: [1, 0],
      noteIds: [NOTE_A, NOTE_B, NOTE_C],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  },
  computedAt: "2026-01-01T00:00:00Z",
};

function serializedNote(id: string, title: string, body: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: "${title}"`,
    "tags: []",
    "created: 2026-01-01T00:00:00.000Z",
    "updated: 2026-01-01T00:00:00.000Z",
    "---",
    "",
    body,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/hypothesis-data", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/hypothesis-data", {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns empty state when no tensions exist", async () => {
    fetchSpy.spy
      // Read tensions.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.tensionCount).toBe(0);
    expect(json.tensions).toEqual([]);
    expect(json.message).toContain("tension-pass");
  });

  it("returns tensions with full note content for both tension notes", async () => {
    const rawNoteA = serializedNote(
      NOTE_A,
      "Agents and autonomy",
      "Autonomous agents decide independently.",
    );
    const rawNoteB = serializedNote(
      NOTE_B,
      "Controlled systems",
      "Control loops require explicit rules.",
    );
    const rawNoteC = serializedNote(
      NOTE_C,
      "Hybrid approaches",
      "Some systems blend both.",
    );

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteA)) // Note A
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteB)) // Note B
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteC)); // Note C (sibling)

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.tensionCount).toBe(1);
    expect(json.tensions).toHaveLength(1);

    const t = json.tensions[0];
    expect(t.id).toBe("tension-0");
    expect(t.noteA).toBe(NOTE_A);
    expect(t.noteB).toBe(NOTE_B);
    expect(t.similarity).toBe(0.62);
    expect(t.clusterId).toBe("cluster-0");

    expect(t.noteAContent.title).toBe("Agents and autonomy");
    expect(t.noteAContent.body).toBe("Autonomous agents decide independently.");
    expect(t.noteBContent.title).toBe("Controlled systems");
    expect(t.noteBContent.body).toBe("Control loops require explicit rules.");
  });

  it("includes cluster sibling notes (excluding the tension pair)", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_A, "Note A", "Body A.")),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_B, "Note B", "Body B.")),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_C, "Note C", "Body C.")),
      );

    const response = await GET(makeRequest());
    const json = await response.json();

    const t = json.tensions[0];
    // Sibling notes should NOT include noteA or noteB
    expect(Object.keys(t.clusterNotes)).not.toContain(NOTE_A);
    expect(Object.keys(t.clusterNotes)).not.toContain(NOTE_B);
    // But should include NOTE_C
    expect(t.clusterNotes[NOTE_C]).toBeDefined();
    expect(t.clusterNotes[NOTE_C].title).toBe("Note C");
    expect(t.clusterNotes[NOTE_C].body).toBe("Body C.");
  });

  it("sets content to null for a tension note that cannot be fetched", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      // Note A missing
      .mockResolvedValueOnce(fakeGitHub404())
      // Note B found
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_B, "Note B", "Body B.")),
      )
      // Note C found
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_C, "Note C", "Body C.")),
      );

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    const t = json.tensions[0];
    expect(t.noteAContent).toBeNull();
    expect(t.noteBContent.title).toBe("Note B");
  });

  it("includes computedAt from the tensions index", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_A, "Note A", "Body A.")),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_B, "Note B", "Body B.")),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(serializedNote(NOTE_C, "Note C", "Body C.")),
      );

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(json.computedAt).toBe("2026-01-01T00:00:00Z");
  });
});
