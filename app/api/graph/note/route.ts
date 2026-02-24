import { type NextRequest, NextResponse } from "next/server";
import { verifySessionAuth } from "@/src/session";
import { readNote } from "@/src/github";
import { parseNoteContent, NOTE_ID_PATTERN } from "@/src/note";
import { NOTES_DIR } from "@/src/config";

export async function GET(req: NextRequest) {
  if (!(await verifySessionAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteId = req.nextUrl.searchParams.get("id");
  if (!noteId || !NOTE_ID_PATTERN.test(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const raw = await readNote(noteId, NOTES_DIR);
  if (!raw) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const { title, type, body } = parseNoteContent(raw);
  return NextResponse.json({ title, type, body });
}
