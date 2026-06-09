import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestEnv,
  setupFetchSpy,
  fakeGitHub404,
} from "../../__test-setup__";

vi.mock("@/src/session", () => ({ verifySessionAuth: vi.fn() }));
import { verifySessionAuth } from "@/src/session";
import { GET } from "./route";

setupTestEnv();
const fetchSpy = setupFetchSpy();

beforeEach(() => {
  vi.mocked(verifySessionAuth).mockResolvedValue(true);
});

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/graph/data${query}`, {
    method: "GET",
  });
}

describe("GET /api/graph/data", () => {
  it("rejects unauthenticated requests with 401", async () => {
    vi.mocked(verifySessionAuth).mockResolvedValueOnce(false);
    const res = await GET(makeRequest("?kind=analytics"));
    expect(res.status).toBe(401);
  });

  it("rejects an unknown kind with 400", async () => {
    const res = await GET(makeRequest("?kind=bogus"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing kind with 400", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
  });

  it("returns analytics with an empty snapshot history", async () => {
    fetchSpy.spy.mockResolvedValueOnce(fakeGitHub404()); // read snapshots
    const res = await GET(makeRequest("?kind=analytics"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.snapshotCount).toBe(0);
    expect(json.snapshots).toEqual([]);
  });

  it("returns the no-clusters message for theme data", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHub404()) // read clusters
      .mockResolvedValueOnce(fakeGitHub404()); // read tensions
    const res = await GET(makeRequest("?kind=theme"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.clusterCount).toBe(0);
    expect(json.message).toContain("No clusters found");
  });
});
