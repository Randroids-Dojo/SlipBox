import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestEnv,
  setupFetchSpy,
  fakeGitHub404,
  fakeGitHubContents,
  fakeGitHubPut,
} from "../../__test-setup__";

// Session auth is mocked so requests carry no Bearer token.
vi.mock("@/src/session", () => ({ verifySessionAuth: vi.fn() }));
import { verifySessionAuth } from "@/src/session";
import { POST } from "./route";

setupTestEnv();
const fetchSpy = setupFetchSpy();

beforeEach(() => {
  vi.mocked(verifySessionAuth).mockResolvedValue(true);
});

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/graph/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sixNotes = {
  embeddings: {
    "note-a": { noteId: "note-a", vector: [0, 0, 0], model: "m", createdAt: "t" },
    "note-b": { noteId: "note-b", vector: [1, 0, 0], model: "m", createdAt: "t" },
    "note-c": { noteId: "note-c", vector: [0, 1, 0], model: "m", createdAt: "t" },
    "note-d": { noteId: "note-d", vector: [100, 100, 100], model: "m", createdAt: "t" },
    "note-e": { noteId: "note-e", vector: [101, 100, 100], model: "m", createdAt: "t" },
    "note-f": { noteId: "note-f", vector: [100, 101, 100], model: "m", createdAt: "t" },
  },
};

describe("POST /api/graph/action", () => {
  it("rejects unauthenticated requests with 401", async () => {
    vi.mocked(verifySessionAuth).mockResolvedValueOnce(false);
    const res = await POST(makeRequest({ action: "link-pass" }));
    expect(res.status).toBe(401);
  });

  it("rejects an unknown action with 400", async () => {
    const res = await POST(makeRequest({ action: "rm-rf" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing action with 400", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("runs a pass and wraps the result as { action, result }", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(sixNotes), "emb"))
      .mockResolvedValueOnce(fakeGitHub404()) // clusters read
      .mockResolvedValueOnce(fakeGitHubPut("cl")); // clusters write

    const res = await POST(makeRequest({ action: "cluster-pass", k: 2 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe("cluster-pass");
    expect(json.result.clusterCount).toBe(2);
  });

  it("maps a PassValidationError (invalid k) to 400", async () => {
    const res = await POST(makeRequest({ action: "cluster-pass", k: 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("'k' must be an integer >= 2");
  });

  it("maps add-note missing content to 400", async () => {
    const res = await POST(makeRequest({ action: "add-note" }));
    expect(res.status).toBe(400);
  });

  it("maps malformed relations payload to 400", async () => {
    const res = await POST(makeRequest({ action: "relations" }));
    expect(res.status).toBe(400);
  });
});
