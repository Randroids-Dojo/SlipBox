import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  readRelationsIndex,
  readTensionsIndex,
  readDecayIndex,
  readClustersIndex,
  readRefinementsIndex,
  readNote,
} from "@/src/github";
import { parseNoteContent } from "@/src/note";
import { NOTES_DIR } from "@/src/config";
import GraphCanvas from "./GraphCanvas";
import type { GraphData, GraphNode, GraphLink } from "./types";
import type { RefinementSuggestion } from "@/types/refinement";

export default async function GraphPage() {
  const [
    { index: embeddingsIndex },
    { index: backlinksIndex },
    { index: relationsIndex },
    { index: tensionsIndex },
    { index: decayIndex },
    { index: clustersIndex },
    { index: refinementsIndex },
  ] = await Promise.all([
    readEmbeddingsIndex(),
    readBacklinksIndex(),
    readRelationsIndex(),
    readTensionsIndex(),
    readDecayIndex(),
    readClustersIndex(),
    readRefinementsIndex(),
  ]);

  const noteIds = Object.keys(embeddingsIndex.embeddings);

  // Fetch all note content in parallel for title extraction.
  const noteContents = await Promise.all(
    noteIds.map((id) => readNote(id, NOTES_DIR)),
  );

  // noteId → clusterId
  const noteClusterMap: Record<string, string> = {};
  for (const cluster of Object.values(clustersIndex.clusters)) {
    for (const noteId of cluster.noteIds) {
      noteClusterMap[noteId] = cluster.id;
    }
  }

  // noteId → refinement suggestions
  const noteRefinementsMap: Record<string, RefinementSuggestion[]> = {};
  for (const suggestion of Object.values(refinementsIndex.suggestions)) {
    (noteRefinementsMap[suggestion.noteId] ??= []).push(suggestion);
  }

  // canonical pair key → isTension
  const tensionPairs = new Set<string>();
  for (const tension of Object.values(tensionsIndex.tensions)) {
    const [a, b] =
      tension.noteA < tension.noteB
        ? [tension.noteA, tension.noteB]
        : [tension.noteB, tension.noteA];
    tensionPairs.add(`${a}:${b}`);
  }

  const nodes: GraphNode[] = noteIds.map((id, i) => {
    const raw = noteContents[i];
    const parsed = raw
      ? parseNoteContent(raw)
      : { title: undefined, type: undefined, body: "" };
    const decay = decayIndex.records[id];
    return {
      id,
      title: parsed.title ?? id,
      clusterId: noteClusterMap[id] ?? null,
      decayScore: decay?.score ?? 0,
      decayReasons: decay?.reasons ?? [],
      refinements: noteRefinementsMap[id] ?? [],
      linkCount: backlinksIndex.links[id]?.length ?? 0,
      isMeta: parsed.type === "meta",
    };
  });

  // Deduplicated edge list (canonical pair ordering).
  const edgeSet = new Set<string>();
  const links: GraphLink[] = [];
  for (const [noteId, noteLinks] of Object.entries(backlinksIndex.links)) {
    for (const { targetId } of noteLinks) {
      const [a, b] =
        noteId < targetId ? [noteId, targetId] : [targetId, noteId];
      const key = `${a}:${b}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        const relation = relationsIndex.relations[key];
        links.push({
          source: a,
          target: b,
          relationType: relation?.relationType ?? null,
          isTension: tensionPairs.has(key),
        });
      }
    }
  }

  const graphData: GraphData = {
    nodes,
    links,
    clusterIds: Object.keys(clustersIndex.clusters),
  };

  return <GraphCanvas data={graphData} />;
}
