/**
 * POST /api/add-note
 *
 * Full pipeline: create note, embed, similarity pass, update links, commit all
 * changes to PrivateBox.
 *
 * Input:  { "content": "...", "type": "meta" | "hypothesis" (optional) }
 * Output: { "noteId": "...", "type": "meta" | "hypothesis" | null, "linkedNotes": [...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runAddNote } from "@/src/passes";

export const POST = withAuth(async (request: NextRequest) => {
  const body = (await request.json()) as { content?: string; type?: string };
  return NextResponse.json(await runAddNote(body));
});
