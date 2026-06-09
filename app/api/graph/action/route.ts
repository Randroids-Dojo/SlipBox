/**
 * POST /api/graph/action
 *
 * Session-authed dispatcher that lets the browser graph UI run engine actions
 * without the Bearer API key. Mirrors the auth model of /api/graph/note
 * (verifySessionAuth). Each action calls the same src/passes.ts function the
 * Bearer routes use, so behavior is identical.
 *
 * Body: { action, k?, content?, type?, relations?, suggestions? }
 * Response: { action, result } on success; { error } with 400/500 on failure.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifySessionAuth } from "@/src/session";
import { mapPassError } from "@/src/http-errors";
import {
  runLinkPass,
  runClusterPass,
  runTensionPass,
  runDecayPass,
  runExplorationPass,
  runSnapshot,
  runAddNote,
  runRelations,
  runRefinements,
  runFullCycle,
} from "@/src/passes";

const ACTIONS = [
  "link-pass",
  "cluster-pass",
  "tension-pass",
  "decay-pass",
  "exploration-pass",
  "snapshot",
  "full-cycle",
  "add-note",
  "relations",
  "refinements",
] as const;

type Action = (typeof ACTIONS)[number];

interface ActionBody {
  action?: string;
  k?: number;
  content?: string;
  type?: string;
}

export async function POST(req: NextRequest) {
  if (!(await verifySessionAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ActionBody & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action;
  if (!action || !ACTIONS.includes(action as Action)) {
    return NextResponse.json(
      { error: "Unknown or missing action" },
      { status: 400 },
    );
  }

  try {
    let result: unknown;
    switch (action as Action) {
      case "link-pass":
        result = await runLinkPass();
        break;
      case "cluster-pass":
        result = await runClusterPass({ k: body.k });
        break;
      case "tension-pass":
        result = await runTensionPass();
        break;
      case "decay-pass":
        result = await runDecayPass();
        break;
      case "exploration-pass":
        result = await runExplorationPass();
        break;
      case "snapshot":
        result = await runSnapshot();
        break;
      case "full-cycle":
        result = await runFullCycle();
        break;
      case "add-note":
        result = await runAddNote({ content: body.content, type: body.type });
        break;
      case "relations":
        result = await runRelations(body);
        break;
      case "refinements":
        result = await runRefinements(body);
        break;
    }
    return NextResponse.json({ action, result });
  } catch (err) {
    return mapPassError(err);
  }
}
