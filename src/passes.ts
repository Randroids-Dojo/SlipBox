/**
 * Engine pass orchestration, shared by the Bearer-token API routes
 * (app/api/<pass>/route.ts) and the session-authed browser routes
 * (app/api/graph/*). Each `run*` / `compute*` function returns the exact JSON
 * payload the corresponding route used to build, so both callers stay
 * byte-for-byte identical in their responses.
 *
 * Validation and precondition failures that previously returned a 400 from
 * inside a handler are raised as PassValidationError / PassPreconditionError
 * (src/errors.ts); the route layer maps them back to 400.
 */

import { cosineSimilarity, findMatches, matchesToLinks } from "./similarity";
import { rebuildBacklinks, applyMatches } from "./graph";
import { clusterEmbeddings } from "./cluster";
import { detectTensions } from "./tension";
import { computeDecay } from "./decay";
import { detectExplorations } from "./exploration";
import { captureSnapshot } from "./snapshot";
import { createNote, serializeNote, noteFilePath } from "./note";
import { createOpenAIProvider, embedNote } from "./embeddings";
import { canonicalKey, isValidRelationType, upsertRelation } from "./relation";
import {
  SIMILARITY_THRESHOLD,
  MIN_NOTES_FOR_CLUSTERING,
  MIN_NOTES_FOR_TENSION,
  NOTES_DIR,
  BACKLINKS_INDEX_PATH,
} from "./config";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  writeBacklinksIndex,
  readClustersIndex,
  writeClustersIndex,
  readTensionsIndex,
  writeTensionsIndex,
  readDecayIndex,
  writeDecayIndex,
  readRelationsIndex,
  writeRelationsIndex,
  readExplorationsIndex,
  writeExplorationsIndex,
  readSnapshotsIndex,
  writeSnapshotsIndex,
  readRefinementsIndex,
  writeRefinementsIndex,
  fetchNotesMap,
  updateJsonFileWithRetry,
  upsertEmbeddingWithRetry,
  writeFile,
} from "./github";
import {
  type BacklinksIndex,
  type NoteLink,
  type NoteType,
  type RelationType,
  type RefinementType,
  type GraphSnapshot,
  NOTE_TYPES,
  REFINEMENT_TYPES,
  emptyBacklinksIndex,
} from "@/types";

export { PassValidationError, PassPreconditionError } from "./errors";
import { PassValidationError, PassPreconditionError } from "./errors";

// ---------------------------------------------------------------------------
// link-pass
// ---------------------------------------------------------------------------

export interface LinkPassResult {
  message: string;
  notesProcessed?: number;
  totalLinks: number;
}

export async function runLinkPass(): Promise<LinkPassResult> {
  const [embResult, blResult] = await Promise.all([
    readEmbeddingsIndex(),
    readBacklinksIndex(),
  ]);

  const noteIds = Object.keys(embResult.index.embeddings);

  if (noteIds.length === 0) {
    return { message: "No notes to link", totalLinks: 0 };
  }

  // Upper-triangle of the similarity matrix: each pair scored once.
  const linkPairs: { noteA: string; noteB: string; similarity: number }[] = [];

  for (let i = 0; i < noteIds.length; i++) {
    const a = embResult.index.embeddings[noteIds[i]];
    for (let j = i + 1; j < noteIds.length; j++) {
      const b = embResult.index.embeddings[noteIds[j]];
      const similarity = cosineSimilarity(a.vector, b.vector);
      if (similarity >= SIMILARITY_THRESHOLD) {
        linkPairs.push({ noteA: noteIds[i], noteB: noteIds[j], similarity });
      }
    }
  }

  const newBacklinks = rebuildBacklinks(linkPairs);
  await writeBacklinksIndex(
    newBacklinks,
    blResult.sha,
    "Recompute all backlinks (link-pass)",
  );

  return {
    message: "Link pass complete",
    notesProcessed: noteIds.length,
    totalLinks: linkPairs.length,
  };
}

// ---------------------------------------------------------------------------
// cluster-pass
// ---------------------------------------------------------------------------

export interface ClusterPassResult {
  message: string;
  noteCount: number;
  clusterCount: number;
  clusters?: { id: string; size: number; noteIds: string[] }[];
}

export async function runClusterPass(opts?: {
  k?: number;
}): Promise<ClusterPassResult> {
  const requestedK = opts?.k;
  if (requestedK !== undefined) {
    if (
      typeof requestedK !== "number" ||
      requestedK < 2 ||
      !Number.isInteger(requestedK)
    ) {
      throw new PassValidationError("Optional 'k' must be an integer >= 2");
    }
  }

  const [embResult, clResult] = await Promise.all([
    readEmbeddingsIndex(),
    readClustersIndex(),
  ]);

  const noteCount = Object.keys(embResult.index.embeddings).length;

  if (noteCount < MIN_NOTES_FOR_CLUSTERING) {
    return {
      message: `Not enough notes to cluster (have ${noteCount}, need ${MIN_NOTES_FOR_CLUSTERING})`,
      noteCount,
      clusterCount: 0,
    };
  }

  const clustersIndex = clusterEmbeddings(embResult.index, { k: requestedK });
  const clusterCount = Object.keys(clustersIndex.clusters).length;

  await writeClustersIndex(
    clustersIndex,
    clResult.sha,
    "Recompute clusters (cluster-pass)",
  );

  const clusters = Object.values(clustersIndex.clusters).map((c) => ({
    id: c.id,
    size: c.noteIds.length,
    noteIds: c.noteIds,
  }));

  return { message: "Cluster pass complete", noteCount, clusterCount, clusters };
}

// ---------------------------------------------------------------------------
// tension-pass
// ---------------------------------------------------------------------------

export interface TensionPassResult {
  message: string;
  noteCount: number;
  clusterCount?: number;
  tensionCount: number;
  tensions?: {
    id: string;
    noteA: string;
    noteB: string;
    similarity: number;
    clusterId: string;
  }[];
}

export async function runTensionPass(): Promise<TensionPassResult> {
  const [embResult, clResult, tenResult] = await Promise.all([
    readEmbeddingsIndex(),
    readClustersIndex(),
    readTensionsIndex(),
  ]);

  const noteCount = Object.keys(embResult.index.embeddings).length;
  const clusterCount = Object.keys(clResult.index.clusters).length;

  if (noteCount < MIN_NOTES_FOR_TENSION) {
    return {
      message: `Not enough notes for tension detection (have ${noteCount}, need ${MIN_NOTES_FOR_TENSION})`,
      noteCount,
      tensionCount: 0,
    };
  }

  if (clusterCount === 0) {
    throw new PassPreconditionError("No clusters found. Run cluster-pass first.");
  }

  const tensionsIndex = detectTensions(embResult.index, clResult.index);
  const tensionCount = Object.keys(tensionsIndex.tensions).length;

  await writeTensionsIndex(
    tensionsIndex,
    tenResult.sha,
    "Detect tensions (tension-pass)",
  );

  const tensions = Object.values(tensionsIndex.tensions).map((t) => ({
    id: t.id,
    noteA: t.noteA,
    noteB: t.noteB,
    similarity: t.similarity,
    clusterId: t.clusterId,
  }));

  return {
    message: "Tension pass complete",
    noteCount,
    clusterCount,
    tensionCount,
    tensions,
  };
}

// ---------------------------------------------------------------------------
// decay-pass
// ---------------------------------------------------------------------------

export interface DecayPassResult {
  message: string;
  noteCount: number;
  staleCount: number;
  records: { noteId: string; score: number; reasons: string[] }[];
}

export async function runDecayPass(): Promise<DecayPassResult> {
  const [embResult, blResult, clResult, decResult] = await Promise.all([
    readEmbeddingsIndex(),
    readBacklinksIndex(),
    readClustersIndex(),
    readDecayIndex(),
  ]);

  const noteCount = Object.keys(embResult.index.embeddings).length;

  const decayIndex = computeDecay(
    embResult.index,
    blResult.index,
    clResult.index,
  );

  const staleCount = Object.keys(decayIndex.records).length;

  await writeDecayIndex(decayIndex, decResult.sha, "Detect decay (decay-pass)");

  const records = Object.values(decayIndex.records).map((r) => ({
    noteId: r.noteId,
    score: r.score,
    reasons: r.reasons,
  }));

  return { message: "Decay pass complete", noteCount, staleCount, records };
}

// ---------------------------------------------------------------------------
// exploration-pass
// ---------------------------------------------------------------------------

export interface ExplorationPassResult {
  message: string;
  suggestionCount: number;
  byType: Record<string, number>;
  suggestions: unknown[];
}

export async function runExplorationPass(): Promise<ExplorationPassResult> {
  const [embResult, blResult, clResult, relResult, expResult] =
    await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
      readClustersIndex(),
      readRelationsIndex(),
      readExplorationsIndex(),
    ]);

  const allClusterNoteIds = [
    ...new Set(
      Object.values(clResult.index.clusters).flatMap((c) => c.noteIds),
    ),
  ];

  const notesMap = await fetchNotesMap(allClusterNoteIds, NOTES_DIR);

  const metaNoteIds = new Set<string>(
    Object.entries(notesMap)
      .filter(([, parsed]) => parsed.type === "meta")
      .map(([id]) => id),
  );

  const explorationsIndex = detectExplorations(
    embResult.index,
    blResult.index,
    clResult.index,
    relResult.index,
    { metaNoteIds },
  );

  const suggestionCount = explorationsIndex.suggestions.length;

  await writeExplorationsIndex(
    explorationsIndex,
    expResult.sha,
    "Detect structural gaps (exploration-pass)",
  );

  const byType = explorationsIndex.suggestions.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s.type] = (acc[s.type] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return {
    message: "Exploration pass complete",
    suggestionCount,
    byType,
    suggestions: explorationsIndex.suggestions,
  };
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

export async function runSnapshot(): Promise<{ snapshot: GraphSnapshot }> {
  const [embResult, blResult, clResult, tenResult, decResult, snapResult] =
    await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
      readClustersIndex(),
      readTensionsIndex(),
      readDecayIndex(),
      readSnapshotsIndex(),
    ]);

  const snapshot = captureSnapshot(
    embResult.index,
    blResult.index,
    clResult.index,
    tenResult.index,
    decResult.index,
  );

  const snapshotsIndex = snapResult.index;
  snapshotsIndex.snapshots.push(snapshot);

  await writeSnapshotsIndex(
    snapshotsIndex,
    snapResult.sha,
    "Capture graph snapshot",
  );

  return { snapshot };
}

// ---------------------------------------------------------------------------
// add-note
// ---------------------------------------------------------------------------

export interface AddNoteResult {
  noteId: string;
  type: NoteType | null;
  linkedNotes: { noteId: string; similarity: number }[];
}

export async function runAddNote(input: {
  content?: string;
  type?: string;
}): Promise<AddNoteResult> {
  if (!input.content || typeof input.content !== "string" || !input.content.trim()) {
    throw new PassValidationError(
      "Request body must include a non-empty 'content' string",
    );
  }

  if (
    input.type !== undefined &&
    !(NOTE_TYPES as readonly string[]).includes(input.type)
  ) {
    throw new PassValidationError(
      `Invalid note type. Must be one of: ${NOTE_TYPES.join(", ")}`,
    );
  }

  const noteType = input.type as NoteType | undefined;

  const note = createNote({
    content: input.content,
    metadata: noteType ? { type: noteType } : undefined,
  });

  const provider = createOpenAIProvider();
  const [embedding, embResult] = await Promise.all([
    embedNote(note.id, note.content, provider),
    readEmbeddingsIndex(),
  ]);

  const matches = findMatches(
    embedding.vector,
    embResult.index,
    undefined,
    new Set([note.id]),
  );
  const links: NoteLink[] = matchesToLinks(matches);
  note.links = links;

  const serialized = serializeNote(note);
  const path = noteFilePath(note.id, NOTES_DIR);

  await writeFile({
    path,
    content: serialized,
    message: `Add note ${note.id}`,
  });

  await updateJsonFileWithRetry<BacklinksIndex>(
    BACKLINKS_INDEX_PATH,
    emptyBacklinksIndex,
    (idx) => applyMatches(idx, note.id, links),
    `Update backlinks: add ${note.id}`,
  );

  await upsertEmbeddingWithRetry(
    note.id,
    embedding,
    `Update embeddings: add ${note.id}`,
  );

  return {
    noteId: note.id,
    type: note.metadata.type ?? null,
    linkedNotes: links.map((l) => ({
      noteId: l.targetId,
      similarity: l.similarity,
    })),
  };
}

// ---------------------------------------------------------------------------
// relations (LLM paste-back)
// ---------------------------------------------------------------------------

interface RelationInput {
  noteA: string;
  noteB: string;
  relationType: string;
  reason: string;
}

export interface RelationsResult {
  message: string;
  updated: number;
  total: number;
}

export async function runRelations(body: unknown): Promise<RelationsResult> {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).relations)
  ) {
    throw new PassValidationError("Request body must be { relations: [...] }");
  }

  const inputs = (body as { relations: unknown[] }).relations;

  if (inputs.length === 0) {
    throw new PassValidationError("relations array must not be empty");
  }

  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    if (!item || typeof item !== "object") {
      throw new PassValidationError(`relations[${i}] is not an object`);
    }
    const { noteA, noteB, relationType, reason } = item as Record<
      string,
      unknown
    >;
    if (typeof noteA !== "string" || !noteA) {
      throw new PassValidationError(
        `relations[${i}].noteA must be a non-empty string`,
      );
    }
    if (typeof noteB !== "string" || !noteB) {
      throw new PassValidationError(
        `relations[${i}].noteB must be a non-empty string`,
      );
    }
    if (noteA === noteB) {
      throw new PassValidationError(
        `relations[${i}]: noteA and noteB must be different`,
      );
    }
    if (typeof relationType !== "string" || !isValidRelationType(relationType)) {
      throw new PassValidationError(
        `relations[${i}].relationType "${relationType}" is not a valid relation type`,
      );
    }
    if (typeof reason !== "string" || !reason) {
      throw new PassValidationError(
        `relations[${i}].reason must be a non-empty string`,
      );
    }
  }

  const validatedInputs = inputs as RelationInput[];

  const [blResult, relResult] = await Promise.all([
    readBacklinksIndex(),
    readRelationsIndex(),
  ]);

  const backlinks = blResult.index;
  const relationsIndex = relResult.index;

  const similarityMap = new Map<string, number>();
  for (const [noteId, links] of Object.entries(backlinks.links)) {
    for (const link of links) {
      const key = canonicalKey(noteId, link.targetId);
      if (!similarityMap.has(key)) {
        similarityMap.set(key, link.similarity);
      }
    }
  }

  for (let i = 0; i < validatedInputs.length; i++) {
    const { noteA, noteB } = validatedInputs[i];
    const key = canonicalKey(noteA, noteB);
    if (!similarityMap.has(key)) {
      throw new PassValidationError(
        `relations[${i}]: pair (${noteA}, ${noteB}) not found in backlinks index`,
      );
    }
  }

  const now = new Date().toISOString();
  for (const { noteA, noteB, relationType, reason } of validatedInputs) {
    const similarity = similarityMap.get(canonicalKey(noteA, noteB))!;
    upsertRelation(
      relationsIndex,
      noteA,
      noteB,
      relationType as RelationType,
      reason,
      similarity,
      now,
    );
  }

  await writeRelationsIndex(
    relationsIndex,
    relResult.sha,
    `Classify ${validatedInputs.length} relations (relations)`,
  );

  const total = Object.keys(relationsIndex.relations).length;

  return { message: "Relations updated", updated: validatedInputs.length, total };
}

// ---------------------------------------------------------------------------
// refinements (LLM paste-back)
// ---------------------------------------------------------------------------

interface SuggestionInput {
  noteId: string;
  type: string;
  suggestion: string;
  reason: string;
  relatedNoteIds?: string[];
}

export interface RefinementsResult {
  updated: number;
  total: number;
}

export async function runRefinements(body: unknown): Promise<RefinementsResult> {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).suggestions) ||
    (body as { suggestions: unknown[] }).suggestions.length === 0
  ) {
    throw new PassValidationError(
      "Request body must include a non-empty suggestions array.",
    );
  }

  const inputs = (body as { suggestions: SuggestionInput[] }).suggestions;

  for (const s of inputs) {
    if (!s || typeof s !== "object") {
      throw new PassValidationError("Each suggestion must be an object.");
    }
    if (!s.noteId || typeof s.noteId !== "string") {
      throw new PassValidationError("Each suggestion must have a noteId string.");
    }
    if (!(REFINEMENT_TYPES as readonly string[]).includes(s.type)) {
      throw new PassValidationError(
        `Invalid refinement type: "${s.type}". Must be one of: ${REFINEMENT_TYPES.join(", ")}.`,
      );
    }
    if (!s.suggestion || typeof s.suggestion !== "string") {
      throw new PassValidationError(
        "Each suggestion must have a suggestion string.",
      );
    }
    if (!s.reason || typeof s.reason !== "string") {
      throw new PassValidationError("Each suggestion must have a reason string.");
    }
  }

  const refResult = await readRefinementsIndex();
  const index = refResult.index;
  const now = new Date().toISOString();

  for (const s of inputs) {
    const key = `${s.noteId}:${s.type}`;
    index.suggestions[key] = {
      id: key,
      noteId: s.noteId,
      type: s.type as RefinementType,
      suggestion: s.suggestion,
      reason: s.reason,
      relatedNoteIds: Array.isArray(s.relatedNoteIds) ? s.relatedNoteIds : [],
      generatedAt: now,
    };
  }

  index.updatedAt = now;
  const total = Object.keys(index.suggestions).length;

  await writeRefinementsIndex(
    index,
    refResult.sha,
    "Update refinement suggestions",
  );

  return { updated: inputs.length, total };
}

// ---------------------------------------------------------------------------
// full cycle
// ---------------------------------------------------------------------------

export interface FullCycleResult {
  steps: { name: string; ok: boolean; summary?: unknown; skipped?: string }[];
}

/**
 * Run the maintenance passes in the nightly order: link, cluster, tension,
 * then decay and exploration in parallel, then snapshot. A tension-pass
 * precondition failure (no clusters, e.g. too few notes) is a soft skip so the
 * cycle still completes.
 */
export async function runFullCycle(): Promise<FullCycleResult> {
  const steps: FullCycleResult["steps"] = [];

  steps.push({ name: "link-pass", ok: true, summary: await runLinkPass() });
  steps.push({ name: "cluster-pass", ok: true, summary: await runClusterPass() });

  try {
    steps.push({
      name: "tension-pass",
      ok: true,
      summary: await runTensionPass(),
    });
  } catch (e) {
    if (e instanceof PassPreconditionError) {
      steps.push({ name: "tension-pass", ok: true, skipped: e.message });
    } else {
      throw e;
    }
  }

  const [decay, exploration] = await Promise.all([
    runDecayPass(),
    runExplorationPass(),
  ]);
  steps.push({ name: "decay-pass", ok: true, summary: decay });
  steps.push({ name: "exploration-pass", ok: true, summary: exploration });

  steps.push({ name: "snapshot", ok: true, summary: await runSnapshot() });

  return { steps };
}

// ---------------------------------------------------------------------------
// Read-only data for the LLM loop (GET endpoints)
// ---------------------------------------------------------------------------

export async function computeThemeData() {
  const [clResult, tenResult] = await Promise.all([
    readClustersIndex(),
    readTensionsIndex(),
  ]);

  const clusters = Object.values(clResult.index.clusters);
  const tensions = Object.values(tenResult.index.tensions);

  if (clusters.length === 0) {
    return {
      message: "No clusters found. Run cluster-pass first.",
      clusters: [],
      tensions: [],
      clusterCount: 0,
      noteCount: 0,
      tensionCount: 0,
    };
  }

  const allNoteIds = [...new Set(clusters.flatMap((c) => c.noteIds))];
  const notesMap = await fetchNotesMap(allNoteIds, NOTES_DIR);

  const clusterPayload = clusters.map((c) => ({
    id: c.id,
    noteIds: c.noteIds,
    notes: Object.fromEntries(
      c.noteIds.filter((id) => notesMap[id]).map((id) => [id, notesMap[id]]),
    ),
  }));

  return {
    clusters: clusterPayload,
    tensions: tensions.map((t) => ({
      id: t.id,
      noteA: t.noteA,
      noteB: t.noteB,
      similarity: t.similarity,
      clusterId: t.clusterId,
    })),
    clusterCount: clusters.length,
    noteCount: allNoteIds.length,
    tensionCount: tensions.length,
    computedAt: clResult.index.computedAt,
  };
}

export async function computeLinkData(opts?: { unclassifiedOnly?: boolean }) {
  const unclassifiedOnly = opts?.unclassifiedOnly === true;

  const [blResult, relResult] = await Promise.all([
    readBacklinksIndex(),
    readRelationsIndex(),
  ]);

  const backlinks = blResult.index;
  const relations = relResult.index;

  const seenKeys = new Set<string>();
  const allPairs: Array<{ noteA: string; noteB: string; similarity: number }> =
    [];

  for (const [noteId, links] of Object.entries(backlinks.links)) {
    for (const link of links) {
      const key = canonicalKey(noteId, link.targetId);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const [a, b] =
          noteId < link.targetId
            ? [noteId, link.targetId]
            : [link.targetId, noteId];
        allPairs.push({ noteA: a, noteB: b, similarity: link.similarity });
      }
    }
  }

  const classifiedCount = allPairs.filter(
    (p) => !!relations.relations[canonicalKey(p.noteA, p.noteB)],
  ).length;

  const filteredPairs = unclassifiedOnly
    ? allPairs.filter(
        (p) => !relations.relations[canonicalKey(p.noteA, p.noteB)],
      )
    : allPairs;

  const allNoteIds = [
    ...new Set(filteredPairs.flatMap((p) => [p.noteA, p.noteB])),
  ];

  const notesMap = await fetchNotesMap(allNoteIds, NOTES_DIR);

  const pairs = filteredPairs.map((p) => {
    const key = canonicalKey(p.noteA, p.noteB);
    return {
      noteA: p.noteA,
      noteB: p.noteB,
      similarity: p.similarity,
      noteAContent: notesMap[p.noteA] ?? null,
      noteBContent: notesMap[p.noteB] ?? null,
      relation: relations.relations[key] ?? null,
    };
  });

  return {
    pairs,
    pairCount: pairs.length,
    classifiedCount,
    computedAt: new Date().toISOString(),
  };
}

export async function computeHypothesisData() {
  const [tenResult, clResult] = await Promise.all([
    readTensionsIndex(),
    readClustersIndex(),
  ]);

  const tensions = Object.values(tenResult.index.tensions);
  const clustersMap = clResult.index.clusters;

  if (tensions.length === 0) {
    return {
      message: "No tensions found. Run tension-pass first.",
      tensions: [],
      tensionCount: 0,
      computedAt: tenResult.index.computedAt,
    };
  }

  const allNoteIdSet = new Set<string>();
  for (const t of tensions) {
    allNoteIdSet.add(t.noteA);
    allNoteIdSet.add(t.noteB);
    const cluster = clustersMap[t.clusterId];
    if (cluster) {
      for (const id of cluster.noteIds) allNoteIdSet.add(id);
    }
  }

  const notesMap = await fetchNotesMap([...allNoteIdSet], NOTES_DIR);

  const tensionPayload = tensions.map((t) => {
    const cluster = clustersMap[t.clusterId];
    const clusterNotes: Record<string, { title?: string; body: string }> = {};
    if (cluster) {
      for (const id of cluster.noteIds) {
        if (id !== t.noteA && id !== t.noteB && notesMap[id]) {
          clusterNotes[id] = notesMap[id];
        }
      }
    }
    return {
      id: t.id,
      noteA: t.noteA,
      noteB: t.noteB,
      similarity: t.similarity,
      clusterId: t.clusterId,
      noteAContent: notesMap[t.noteA] ?? null,
      noteBContent: notesMap[t.noteB] ?? null,
      clusterNotes,
    };
  });

  return {
    tensions: tensionPayload,
    tensionCount: tensions.length,
    computedAt: tenResult.index.computedAt,
  };
}

export async function computeRefinementData(opts?: { clusterId?: string }) {
  const filterClusterId = opts?.clusterId;

  const [clResult, decResult] = await Promise.all([
    readClustersIndex(),
    readDecayIndex(),
  ]);

  const allClusters = Object.values(clResult.index.clusters);
  const clusters = filterClusterId
    ? allClusters.filter((c) => c.id === filterClusterId)
    : allClusters;

  if (clusters.length === 0) {
    return {
      message: filterClusterId
        ? `Cluster "${filterClusterId}" not found.`
        : "No clusters found. Run cluster-pass first.",
      clusters: [],
      clusterCount: 0,
      noteCount: 0,
      computedAt: clResult.index.computedAt,
    };
  }

  const allNoteIdSet = new Set<string>();
  for (const cluster of clusters) {
    for (const id of cluster.noteIds) allNoteIdSet.add(id);
  }
  const noteIdList = [...allNoteIdSet];
  const notesMap = await fetchNotesMap(noteIdList, NOTES_DIR);

  const decayRecords = decResult.index.records;

  const clusterPayload = clusters.map((cluster) => {
    const notes: Record<
      string,
      {
        title?: string;
        body: string;
        decay?: { score: number; reasons: string[] };
      }
    > = {};
    for (const id of cluster.noteIds) {
      if (notesMap[id]) {
        const decay = decayRecords[id];
        notes[id] = {
          ...notesMap[id],
          ...(decay
            ? { decay: { score: decay.score, reasons: decay.reasons } }
            : {}),
        };
      }
    }
    return { id: cluster.id, memberCount: cluster.noteIds.length, notes };
  });

  return {
    clusters: clusterPayload,
    clusterCount: clusters.length,
    noteCount: noteIdList.length,
    computedAt: clResult.index.computedAt,
  };
}

// ---------------------------------------------------------------------------
// analytics
// ---------------------------------------------------------------------------

interface SnapshotDelta {
  noteDelta: number;
  linkDelta: number;
  clusterDelta: number;
  tensionDelta: number;
  decayDelta: number;
}

interface SnapshotWithDelta extends GraphSnapshot {
  delta: SnapshotDelta | null;
}

function computeDelta(
  current: GraphSnapshot,
  previous: GraphSnapshot,
): SnapshotDelta {
  return {
    noteDelta: current.noteCount - previous.noteCount,
    linkDelta: current.linkCount - previous.linkCount,
    clusterDelta: current.clusterCount - previous.clusterCount,
    tensionDelta: current.tensionCount - previous.tensionCount,
    decayDelta: current.decayCount - previous.decayCount,
  };
}

export async function computeAnalytics(since?: string) {
  const { index } = await readSnapshotsIndex();
  let snapshots = index.snapshots;

  if (since) {
    const sinceDate = new Date(since);
    snapshots = snapshots.filter((s) => new Date(s.capturedAt) >= sinceDate);
  }

  const withDeltas: SnapshotWithDelta[] = snapshots.map((snapshot, i) => {
    const delta = i === 0 ? null : computeDelta(snapshot, snapshots[i - 1]);
    return { ...snapshot, delta };
  });

  return {
    snapshots: withDeltas,
    snapshotCount: withDeltas.length,
    ...(since && { since }),
  };
}
