/**
 * POST /api/decay-pass
 *
 * Scores every note for staleness using four pure-math signals:
 * no links, low link density, cluster outlier, and no cluster.
 * Fetches embeddings, backlinks, and clusters from PrivateBox,
 * runs decay detection, and commits the resulting decay index
 * (decay.json) back to PrivateBox.
 *
 * Only notes whose score meets DECAY_SCORE_THRESHOLD are included
 * in the index. No LLM calls are made.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/src/auth";
import { computeDecay } from "@/src/decay";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  readClustersIndex,
  readDecayIndex,
  writeDecayIndex,
} from "@/src/github";

export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;

    // 1. Fetch current embeddings, backlinks, clusters, and existing decay index
    const [embResult, blResult, clResult, decResult] = await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
      readClustersIndex(),
      readDecayIndex(),
    ]);

    const noteCount = Object.keys(embResult.index.embeddings).length;

    // 2. Compute decay scores
    const decayIndex = computeDecay(
      embResult.index,
      blResult.index,
      clResult.index,
    );

    const staleCount = Object.keys(decayIndex.records).length;

    // 3. Commit updated decay index
    await writeDecayIndex(
      decayIndex,
      decResult.sha,
      "Detect decay (decay-pass)",
    );

    // 4. Build summary for response
    const records = Object.values(decayIndex.records).map((r) => ({
      noteId: r.noteId,
      score: r.score,
      reasons: r.reasons,
    }));

    return NextResponse.json({
      message: "Decay pass complete",
      noteCount,
      staleCount,
      records,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
