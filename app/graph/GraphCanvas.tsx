"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { GraphNode, GraphLink, GraphData } from "./types";
import type { RelationType } from "@/types/relation";
import { NOTE_TYPES } from "@/types";

// ForceGraph2D accesses window at module load - must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <p style={{ padding: 16, background: "#0f172a", color: "#e2e8f0", margin: 0, height: "100%" }}>Loading graph…</p>,
});

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const CLUSTER_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#f97316",
  "#8b5cf6",
  "#84cc16",
  "#14b8a6",
  "#e11d48",
];

const RELATION_COLORS: Record<RelationType, string> = {
  supports: "#22c55e",
  contradicts: "#ef4444",
  refines: "#3b82f6",
  "is-example-of": "#a855f7",
  "contrasts-with": "#eab308",
};

const UNCLASSIFIED_EDGE_COLOR = "#475569";
const GRAY = "#6b7280";

const DARK = {
  bg: "#0f172a",
  toolbar: "#1e293b",
  border: "#334155",
  sidebar: "#1e293b",
  text: "#e2e8f0",
  muted: "#64748b",
  faint: "#94a3b8",
  suggestion: "#0f172a",
};

function lerpColor(hex1: string, hex2: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

// ---------------------------------------------------------------------------
// Note detail
// ---------------------------------------------------------------------------

interface NoteDetail {
  title?: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  data: GraphData;
}

export default function GraphCanvas({ data }: Props) {
  const { clusterIds } = data;
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingNodeId = useRef<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Filter state
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null,
  );
  const [showMetaNotes, setShowMetaNotes] = useState(true);
  const [showTensions, setShowTensions] = useState(true);

  // Overlays
  const [showHelp, setShowHelp] = useState(false);
  const [showActions, setShowActions] = useState(false);

  // Action state: name of the action currently running (null when idle).
  const [running, setRunning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // POST an action to the session-authed dispatcher, then refresh the graph.
  const runAction = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      setRunning(action);
      setFeedback(null);
      try {
        const res = await fetch("/api/graph/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFeedback({ ok: false, text: json.error ?? "Action failed" });
          return false;
        }
        setFeedback({ ok: true, text: summarize(action, json.result) });
        // Re-run the force-dynamic server component to repaint the graph.
        router.refresh();
        return true;
      } catch {
        setFeedback({ ok: false, text: "Network error" });
        return false;
      } finally {
        setRunning(null);
      }
    },
    [router],
  );

  // Sidebar state
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [noteDetail, setNoteDetail] = useState<NoteDetail | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  // Clear sidebar when filters change (selected node may no longer be visible).
  // Also cancel any in-flight fetch so its finally block does not flip loadingNote.
  useEffect(() => {
    pendingNodeId.current = null;
    setSelectedNode(null);
    setNoteDetail(null);
    setLoadingNote(false);
  }, [showMetaNotes, selectedClusterId]);

  // A cluster-pass can rename clusters; drop a filter that no longer exists.
  useEffect(() => {
    if (selectedClusterId && !clusterIds.includes(selectedClusterId)) {
      setSelectedClusterId(null);
    }
  }, [clusterIds, selectedClusterId]);

  // Track container dimensions.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setDimensions({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Cluster → color map.
  const clusterColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    clusterIds.forEach((id, i) => {
      map[id] = CLUSTER_COLORS[i % CLUSTER_COLORS.length]!;
    });
    return map;
  }, [clusterIds]);

  // Filtered graph data.
  const filteredData = useMemo(() => {
    let nodes = data.nodes;
    if (!showMetaNotes) nodes = nodes.filter((n) => !n.isMeta);
    if (selectedClusterId)
      nodes = nodes.filter((n) => n.clusterId === selectedClusterId);
    const nodeIds = new Set(nodes.map((n) => n.id));
    // Copy links so force-graph can mutate source/target to node refs
    // without affecting the original data.
    const links = data.links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((l) => ({ ...l }));
    return { nodes, links };
  }, [data, showMetaNotes, selectedClusterId]);

  // Fetch note detail on node click.
  // Uses a ref to discard results from superseded clicks.
  const handleNodeClick = useCallback(async (node: object) => {
    const n = node as GraphNode;
    pendingNodeId.current = n.id;
    setSelectedNode(n);
    setNoteDetail(null);
    setLoadingNote(true);
    try {
      const res = await fetch(`/api/graph/note?id=${n.id}`);
      if (res.ok && pendingNodeId.current === n.id) {
        setNoteDetail((await res.json()) as NoteDetail);
      }
    } finally {
      if (pendingNodeId.current === n.id) setLoadingNote(false);
    }
  }, []);

  const getNodeColor = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      const base = clusterColorMap[n.clusterId ?? ""] ?? GRAY;
      if (n.decayScore === 0) return base;
      return lerpColor(base, GRAY, n.decayScore * 0.7);
    },
    [clusterColorMap],
  );

  const getLinkColor = useCallback((link: object) => {
    const l = link as GraphLink;
    return l.relationType
      ? (RELATION_COLORS[l.relationType] ?? UNCLASSIFIED_EDGE_COLOR)
      : UNCLASSIFIED_EDGE_COLOR;
  }, []);

  const getLinkDash = useCallback(
    (link: object) => {
      const l = link as GraphLink;
      return showTensions && l.isTension ? [4, 2] : null;
    },
    [showTensions],
  );

  const getNodeVal = useCallback((node: object) => {
    return Math.max(1, (node as GraphNode).linkCount);
  }, []);

  const getNodeLabel = useCallback((node: object) => {
    const n = node as GraphNode;
    return n.title !== n.id ? `${n.title}\n${n.id}` : n.id;
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/graph/login";
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: DARK.bg, color: DARK.text }}>
      {/* Toolbar */}
      <div
        style={{
          padding: "8px 16px",
          display: "flex",
          gap: "16px",
          alignItems: "center",
          borderBottom: `1px solid ${DARK.border}`,
          background: DARK.toolbar,
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.95rem", color: DARK.text }}>
          SlipBox Graph
        </span>

        <select
          value={selectedClusterId ?? ""}
          onChange={(e) => setSelectedClusterId(e.target.value || null)}
          style={{ fontSize: "0.85rem", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: "2px 4px" }}
        >
          <option value="">All clusters</option>
          {clusterIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <label style={{ fontSize: "0.85rem", display: "flex", gap: 4, color: DARK.text }}>
          <input
            type="checkbox"
            checked={showMetaNotes}
            onChange={(e) => setShowMetaNotes(e.target.checked)}
          />
          Meta notes
        </label>

        <label style={{ fontSize: "0.85rem", display: "flex", gap: 4, color: DARK.text }}>
          <input
            type="checkbox"
            checked={showTensions}
            onChange={(e) => setShowTensions(e.target.checked)}
          />
          Tensions (dashed)
        </label>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            fontSize: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          {(Object.entries(RELATION_COLORS) as [RelationType, string][]).map(
            ([type, color]) => (
              <span key={type} style={{ display: "flex", gap: 4, color: DARK.text }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    background: color,
                    borderRadius: 2,
                    display: "inline-block",
                    marginTop: 1,
                  }}
                />
                {type}
              </span>
            ),
          )}
        </div>

        <button
          onClick={() => setShowActions(true)}
          style={{ marginLeft: "auto", fontSize: "0.85rem", background: CLUSTER_COLORS[0], color: "#fff", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}
        >
          Actions
        </button>

        <button
          onClick={handleSignOut}
          style={{ fontSize: "0.85rem", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}
        >
          Sign out
        </button>
      </div>

      {/* Graph + sidebar */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div ref={containerRef} style={{ flex: 1, overflow: "hidden" }}>
          <ForceGraph2D
            graphData={filteredData}
            width={dimensions.width}
            height={dimensions.height}
            nodeLabel={getNodeLabel}
            nodeVal={getNodeVal}
            nodeColor={getNodeColor}
            linkColor={getLinkColor}
            linkLineDash={getLinkDash}
            linkWidth={1.5}
            backgroundColor={DARK.bg}
            onNodeClick={handleNodeClick}
          />
        </div>

        {selectedNode && (
          <Sidebar
            node={selectedNode}
            detail={noteDetail}
            loading={loadingNote}
            clusterColorMap={clusterColorMap}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      {/* Help FAB */}
      <button
        onClick={() => setShowHelp(true)}
        aria-label="Help and glossary"
        title="Help & glossary"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: CLUSTER_COLORS[0],
          color: "#fff",
          border: "none",
          fontSize: "1.4rem",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
        }}
      >
        ?
      </button>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      {showActions && (
        <ActionsDrawer
          onClose={() => setShowActions(false)}
          running={running}
          feedback={feedback}
          runAction={runAction}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarProps {
  node: GraphNode;
  detail: NoteDetail | null;
  loading: boolean;
  clusterColorMap: Record<string, string>;
  onClose: () => void;
}

function Sidebar({ node, detail, loading, clusterColorMap, onClose }: SidebarProps) {
  return (
    <div
      style={{
        width: 320,
        borderLeft: `1px solid ${DARK.border}`,
        padding: 16,
        overflowY: "auto",
        flexShrink: 0,
        background: DARK.sidebar,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        color: DARK.text,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.95rem", wordBreak: "break-word" }}>
            {node.title !== node.id ? node.title : "Untitled"}
          </div>
          <div style={{ fontSize: "0.7rem", color: DARK.muted, marginTop: 2 }}>
            {node.id}
          </div>
        </div>
        <button onClick={onClose} style={{ fontSize: "1.1rem", lineHeight: 1, padding: "0 4px", background: "transparent", color: DARK.faint, border: "none", cursor: "pointer" }}>
          ×
        </button>
      </div>

      {/* Cluster */}
      {node.clusterId && (
        <div style={{ fontSize: "0.8rem" }}>
          <span style={{ color: DARK.muted }}>Cluster </span>
          <span
            style={{
              background: clusterColorMap[node.clusterId] ?? GRAY,
              color: "#fff",
              padding: "1px 6px",
              borderRadius: 10,
              fontSize: "0.75rem",
            }}
          >
            {node.clusterId}
          </span>
        </div>
      )}

      {/* Note body */}
      {loading ? (
        <p style={{ fontSize: "0.8rem", color: DARK.muted }}>Loading…</p>
      ) : detail ? (
        <p
          style={{
            fontSize: "0.8rem",
            color: DARK.text,
            whiteSpace: "pre-wrap",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {detail.body.length > 600
            ? detail.body.slice(0, 600) + "…"
            : detail.body}
        </p>
      ) : null}

      {/* Decay */}
      {node.decayScore > 0 && (
        <div style={{ fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, color: "#fbbf24" }}>
            Decay: {node.decayScore.toFixed(2)}
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "#fcd34d" }}>
            {node.decayReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Refinement suggestions */}
      {node.refinements.length > 0 && (
        <div style={{ fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Suggestions</div>
          {node.refinements.map((r) => (
            <div
              key={r.id}
              style={{
                background: DARK.suggestion,
                border: `1px solid ${DARK.border}`,
                padding: "6px 8px",
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              <div>
                <strong>{r.type}:</strong> {r.suggestion}
              </div>
              <div style={{ color: DARK.muted, marginTop: 2 }}>{r.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help overlay
// ---------------------------------------------------------------------------

/** Relation-type definitions, shown with their edge colors. */
const RELATION_GLOSSARY: Record<RelationType, string> = {
  supports: "Note A gives evidence or reasoning that strengthens note B.",
  contradicts: "The two notes make conflicting claims.",
  refines: "Note A adds precision or nuance to the idea in note B.",
  "is-example-of": "Note A is a concrete instance of the concept in note B.",
  "contrasts-with":
    "The two notes highlight different aspects of the same topic.",
};

interface GlossaryEntry {
  term: string;
  swatch?: string;
  def: string;
}

const GLOSSARY: GlossaryEntry[] = [
  {
    term: "Note",
    def: "An atomic idea - one focused thought. Each dot in the graph is a note.",
  },
  {
    term: "Link",
    def: "An edge between two notes whose meanings are similar (cosine similarity of their embeddings above a threshold). Links are computed automatically, not drawn by hand.",
  },
  {
    term: "Tension",
    def: "A dashed edge between two notes that sit in the same cluster yet are unusually dissimilar - same theme, divergent direction. It flags a pair worth a closer look (a possible contradiction or an under-drawn distinction). Low similarity means topical distance, not a proven contradiction. Toggle with “Tensions (dashed).”",
  },
  {
    term: "Cluster",
    def: "A thematic group of notes discovered by k-means on their embeddings. A note's color shows which cluster it belongs to; filter to one cluster with the dropdown.",
  },
  {
    term: "Meta note",
    def: "An AI-generated synthesis note that summarizes a whole cluster's theme. Toggle with the “Meta notes” checkbox.",
  },
  {
    term: "Decay",
    def: "A staleness score from 0–1 flagging notes that may be neglected: no links, low link density, or sitting far from their cluster's center (an outlier). Higher decay fades a note's color toward gray.",
  },
  {
    term: "Refinement suggestion",
    def: "Advisory, non-destructive recommendations (e.g. retitle, split, merge) shown in a note's sidebar. SlipBox never edits your notes automatically.",
  },
  {
    term: "Node size",
    def: "Proportional to how many links a note has - bigger dots are more connected.",
  },
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Help and glossary"
        style={{
          width: "min(640px, 100%)",
          maxHeight: "85vh",
          overflowY: "auto",
          background: DARK.sidebar,
          border: `1px solid ${DARK.border}`,
          borderRadius: 10,
          padding: 24,
          color: DARK.text,
          boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}>
            SlipBox Graph - Help
          </h2>
          <button
            onClick={onClose}
            aria-label="Close help"
            style={{
              fontSize: "1.3rem",
              lineHeight: 1,
              padding: "0 4px",
              background: "transparent",
              color: DARK.faint,
              border: "none",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: "0.85rem", color: DARK.faint, marginTop: 0, lineHeight: 1.5 }}>
          This is your knowledge graph: every dot is an atomic note, every edge
          a discovered relationship. Click a node to read it and see its cluster,
          decay, and suggestions. Use the toolbar to filter by cluster or toggle
          meta notes and tensions.
        </p>

        {/* Edge colors */}
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "20px 0 8px" }}>
          Edge colors - relation types
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(Object.entries(RELATION_GLOSSARY) as [RelationType, string][]).map(
            ([type, def]) => (
              <div key={type} style={{ display: "flex", gap: 8, fontSize: "0.82rem", lineHeight: 1.45 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    flexShrink: 0,
                    marginTop: 3,
                    background: RELATION_COLORS[type],
                    borderRadius: 2,
                  }}
                />
                <span>
                  <strong>{type}</strong> - {def}
                </span>
              </div>
            ),
          )}
          <div style={{ display: "flex", gap: 8, fontSize: "0.82rem", lineHeight: 1.45 }}>
            <span
              style={{
                width: 12,
                height: 12,
                flexShrink: 0,
                marginTop: 3,
                background: UNCLASSIFIED_EDGE_COLOR,
                borderRadius: 2,
              }}
            />
            <span>
              <strong>unclassified</strong> - a link that exists but has no
              relation type assigned yet.
            </span>
          </div>
        </div>

        {/* Glossary */}
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "20px 0 8px" }}>
          Glossary
        </h3>
        <dl style={{ margin: 0 }}>
          {GLOSSARY.map((g) => (
            <div key={g.term} style={{ marginBottom: 12 }}>
              <dt style={{ fontWeight: 600, fontSize: "0.85rem" }}>{g.term}</dt>
              <dd style={{ margin: "2px 0 0", fontSize: "0.82rem", color: DARK.faint, lineHeight: 1.5 }}>
                {g.def}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions drawer
// ---------------------------------------------------------------------------

/** Build a one-line human summary of an action result for the feedback area. */
function summarize(action: string, result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(r[k] ?? 0);
  const str = (k: string) => String(r[k] ?? "");
  switch (action) {
    case "link-pass":
      return `Linked ${num("notesProcessed")} notes, ${num("totalLinks")} links.`;
    case "cluster-pass":
      return num("clusterCount")
        ? `${num("clusterCount")} clusters across ${num("noteCount")} notes.`
        : str("message") || "Done.";
    case "tension-pass":
      return str("message").startsWith("Not enough")
        ? str("message")
        : `${num("tensionCount")} tensions found.`;
    case "decay-pass":
      return `${num("staleCount")} stale of ${num("noteCount")} notes.`;
    case "exploration-pass":
      return `${num("suggestionCount")} structural suggestions.`;
    case "snapshot": {
      const s = (r.snapshot ?? {}) as Record<string, unknown>;
      return `Snapshot captured: ${Number(s.noteCount ?? 0)} notes, ${Number(s.linkCount ?? 0)} links.`;
    }
    case "add-note":
      return `Note ${str("noteId")} added, linked to ${Array.isArray(r.linkedNotes) ? r.linkedNotes.length : 0}.`;
    case "relations":
      return `Relations updated: ${num("updated")} (total ${num("total")}).`;
    case "refinements":
      return `Refinements updated: ${num("updated")} (total ${num("total")}).`;
    case "full-cycle": {
      const steps = Array.isArray(r.steps)
        ? (r.steps as Record<string, unknown>[])
        : [];
      const names = steps.map((s) =>
        s.skipped ? `${String(s.name)} (skipped)` : String(s.name),
      );
      return `Full cycle done: ${names.join(", ")}.`;
    }
    default:
      return "Done.";
  }
}

const PASSES: { action: string; label: string }[] = [
  { action: "link-pass", label: "Link pass" },
  { action: "tension-pass", label: "Tension pass" },
  { action: "decay-pass", label: "Decay pass" },
  { action: "exploration-pass", label: "Exploration pass" },
  { action: "snapshot", label: "Snapshot" },
];

const DATA_KINDS: { kind: string; label: string }[] = [
  { kind: "theme", label: "Theme data" },
  { kind: "link", label: "Link data" },
  { kind: "hypothesis", label: "Hypothesis data" },
  { kind: "refinement", label: "Refinement data" },
];

interface ActionsDrawerProps {
  onClose: () => void;
  running: string | null;
  feedback: { ok: boolean; text: string } | null;
  runAction: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
}

function ActionsDrawer({
  onClose,
  running,
  feedback,
  runAction,
}: ActionsDrawerProps) {
  const [k, setK] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteType, setNoteType] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [relationsText, setRelationsText] = useState("");
  const [refinementsText, setRefinementsText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [dataView, setDataView] = useState<{ label: string; json: string } | null>(
    null,
  );
  const [dataLoading, setDataLoading] = useState<string | null>(null);

  const busy = running !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const btn = (variant: "primary" | "plain" = "plain") => ({
    fontSize: "0.8rem",
    background: variant === "primary" ? CLUSTER_COLORS[0] : DARK.bg,
    color: variant === "primary" ? "#fff" : DARK.text,
    border: variant === "primary" ? "none" : `1px solid ${DARK.border}`,
    borderRadius: 4,
    padding: "5px 10px",
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.5 : 1,
  });

  const label = (action: string, text: string) =>
    running === action ? "Running..." : text;

  // GET read-only data and show it as JSON for copy.
  const loadData = useCallback(async (kind: string, lbl: string) => {
    setDataLoading(kind);
    setDataView(null);
    try {
      const res = await fetch(`/api/graph/data?kind=${kind}`);
      const json = await res.json();
      setDataView({ label: lbl, json: JSON.stringify(json, null, 2) });
    } catch {
      setDataView({ label: lbl, json: "Failed to load." });
    } finally {
      setDataLoading(null);
    }
  }, []);

  // Parse a paste-back textarea (array or { key: [...] }) and submit it.
  const submitPaste = useCallback(
    async (kind: "relations" | "refinements", text: string) => {
      setPasteError(null);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setPasteError("That is not valid JSON.");
        return;
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)?.[kind];
      if (!Array.isArray(arr)) {
        setPasteError(`Paste an array, or an object with a "${kind}" array.`);
        return;
      }
      await runAction(kind, { [kind]: arr });
    },
    [runAction],
  );

  const sectionTitle = {
    fontSize: "0.95rem",
    fontWeight: 600,
    margin: "18px 0 8px",
  } as const;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Actions"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: DARK.sidebar,
          border: `1px solid ${DARK.border}`,
          borderRadius: 10,
          padding: 24,
          color: DARK.text,
          boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}>Actions</h2>
          <button
            onClick={onClose}
            aria-label="Close actions"
            style={{ fontSize: "1.3rem", lineHeight: 1, padding: "0 4px", background: "transparent", color: DARK.faint, border: "none", cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        {/* Feedback */}
        {feedback && (
          <div
            style={{
              fontSize: "0.8rem",
              padding: "8px 10px",
              borderRadius: 4,
              marginBottom: 8,
              background: DARK.bg,
              border: `1px solid ${feedback.ok ? RELATION_COLORS.supports : RELATION_COLORS.contradicts}`,
              color: feedback.ok ? DARK.text : "#fca5a5",
            }}
          >
            {feedback.text}
          </div>
        )}

        {/* Maintenance */}
        <h3 style={sectionTitle}>Maintenance passes</h3>
        <p style={{ fontSize: "0.75rem", color: DARK.muted, margin: "0 0 8px" }}>
          These recompute and commit shared index files in PrivateBox.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {PASSES.map((p) => (
            <button key={p.action} disabled={busy} style={btn()} onClick={() => runAction(p.action)}>
              {label(p.action, p.label)}
            </button>
          ))}
          {/* Cluster with optional k */}
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button disabled={busy} style={btn()} onClick={() => runAction("cluster-pass", k.trim() ? { k: Number(k) } : undefined)}>
              {label("cluster-pass", "Cluster pass")}
            </button>
            <input
              type="number"
              min={2}
              placeholder="k"
              value={k}
              onChange={(e) => setK(e.target.value)}
              style={{ width: 48, fontSize: "0.8rem", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: "4px" }}
            />
          </span>
        </div>

        <div style={{ marginTop: 10 }}>
          {confirmKey === "full-cycle" ? (
            <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8rem" }}>
              <span>Run all six passes in order?</span>
              <button disabled={busy} style={btn("primary")} onClick={() => { setConfirmKey(null); runAction("full-cycle"); }}>
                {label("full-cycle", "Confirm")}
              </button>
              <button disabled={busy} style={btn()} onClick={() => setConfirmKey(null)}>Cancel</button>
            </span>
          ) : (
            <button disabled={busy} style={btn("primary")} onClick={() => setConfirmKey("full-cycle")}>
              Run full cycle
            </button>
          )}
        </div>

        {/* Add note */}
        <h3 style={sectionTitle}>Add note</h3>
        <p style={{ fontSize: "0.75rem", color: DARK.muted, margin: "0 0 8px" }}>
          Creates a note and embeds it (uses an OpenAI embedding, a small cost).
        </p>
        <textarea
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          placeholder="One atomic idea..."
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", fontSize: "0.8rem", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: 8, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <select
            value={noteType}
            onChange={(e) => setNoteType(e.target.value)}
            style={{ fontSize: "0.8rem", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: "4px" }}
          >
            <option value="">type: none</option>
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>type: {t}</option>
            ))}
          </select>
          {confirmKey === "add-note" ? (
            <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8rem" }}>
              <button
                disabled={busy}
                style={btn("primary")}
                onClick={async () => {
                  setConfirmKey(null);
                  const ok = await runAction("add-note", {
                    content: noteContent,
                    ...(noteType ? { type: noteType } : {}),
                  });
                  if (ok) setNoteContent("");
                }}
              >
                {label("add-note", "Confirm add")}
              </button>
              <button disabled={busy} style={btn()} onClick={() => setConfirmKey(null)}>Cancel</button>
            </span>
          ) : (
            <button
              disabled={busy || !noteContent.trim()}
              style={{ ...btn(), opacity: busy || !noteContent.trim() ? 0.5 : 1 }}
              onClick={() => setConfirmKey("add-note")}
            >
              Add note
            </button>
          )}
        </div>

        {/* Analytics */}
        <h3 style={sectionTitle}>Analytics</h3>
        <button disabled={!!dataLoading} style={btn()} onClick={() => loadData("analytics", "Analytics")}>
          {dataLoading === "analytics" ? "Loading..." : "View snapshot timeline"}
        </button>

        {/* Advanced */}
        <h3 style={sectionTitle}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ background: "transparent", border: "none", color: DARK.text, fontSize: "0.95rem", fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            {showAdvanced ? "▾" : "▸"} Advanced (LLM loop)
          </button>
        </h3>
        {showAdvanced && (
          <div>
            <p style={{ fontSize: "0.75rem", color: DARK.muted, margin: "0 0 8px" }}>
              View data to hand to an external LLM, then paste its JSON output back.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {DATA_KINDS.map((d) => (
                <button key={d.kind} disabled={!!dataLoading} style={btn()} onClick={() => loadData(d.kind, d.label)}>
                  {dataLoading === d.kind ? "Loading..." : d.label}
                </button>
              ))}
            </div>

            {/* Relations paste-back */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>Submit relations</div>
              <textarea
                value={relationsText}
                onChange={(e) => setRelationsText(e.target.value)}
                placeholder='[{ "noteA": "...", "noteB": "...", "relationType": "supports", "reason": "..." }]'
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", fontSize: "0.75rem", fontFamily: "monospace", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: 8, resize: "vertical" }}
              />
              <button disabled={busy || !relationsText.trim()} style={{ ...btn(), marginTop: 4, opacity: busy || !relationsText.trim() ? 0.5 : 1 }} onClick={() => submitPaste("relations", relationsText)}>
                {label("relations", "Submit relations")}
              </button>
            </div>

            {/* Refinements paste-back */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>Submit refinements</div>
              <textarea
                value={refinementsText}
                onChange={(e) => setRefinementsText(e.target.value)}
                placeholder='[{ "noteId": "...", "type": "retitle", "suggestion": "...", "reason": "..." }]'
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", fontSize: "0.75rem", fontFamily: "monospace", background: DARK.bg, color: DARK.text, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: 8, resize: "vertical" }}
              />
              <button disabled={busy || !refinementsText.trim()} style={{ ...btn(), marginTop: 4, opacity: busy || !refinementsText.trim() ? 0.5 : 1 }} onClick={() => submitPaste("refinements", refinementsText)}>
                {label("refinements", "Submit refinements")}
              </button>
            </div>

            {pasteError && (
              <div style={{ fontSize: "0.78rem", color: "#fca5a5", marginTop: 4 }}>{pasteError}</div>
            )}
          </div>
        )}

        {/* Data viewer */}
        {dataView && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${DARK.border}`, paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{dataView.label}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button style={btn()} onClick={() => navigator.clipboard?.writeText(dataView.json)}>Copy JSON</button>
                <button style={btn()} onClick={() => setDataView(null)}>Close</button>
              </span>
            </div>
            <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", fontSize: "0.72rem", background: DARK.bg, border: `1px solid ${DARK.border}`, borderRadius: 4, padding: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {dataView.json}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
