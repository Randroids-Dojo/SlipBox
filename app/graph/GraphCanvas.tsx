"use client";

import dynamic from "next/dynamic";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { GraphNode, GraphLink, GraphData } from "./types";
import type { RelationType } from "@/types/relation";

// ForceGraph2D accesses window at module load — must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <p style={{ padding: 16 }}>Loading graph…</p>,
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

const UNCLASSIFIED_EDGE_COLOR = "#cbd5e1";
const GRAY = "#9ca3af";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingNodeId = useRef<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Filter state
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null,
  );
  const [showMetaNotes, setShowMetaNotes] = useState(true);
  const [showTensions, setShowTensions] = useState(true);

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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Toolbar */}
      <div
        style={{
          padding: "8px 16px",
          display: "flex",
          gap: "16px",
          alignItems: "center",
          borderBottom: "1px solid #e5e7eb",
          background: "#ffffff",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          SlipBox Graph
        </span>

        <select
          value={selectedClusterId ?? ""}
          onChange={(e) => setSelectedClusterId(e.target.value || null)}
          style={{ fontSize: "0.85rem" }}
        >
          <option value="">All clusters</option>
          {clusterIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <label style={{ fontSize: "0.85rem", display: "flex", gap: 4 }}>
          <input
            type="checkbox"
            checked={showMetaNotes}
            onChange={(e) => setShowMetaNotes(e.target.checked)}
          />
          Meta notes
        </label>

        <label style={{ fontSize: "0.85rem", display: "flex", gap: 4 }}>
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
              <span key={type} style={{ display: "flex", gap: 4 }}>
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
          onClick={handleSignOut}
          style={{ marginLeft: "auto", fontSize: "0.85rem" }}
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
            backgroundColor="#f8fafc"
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
        borderLeft: "1px solid #e5e7eb",
        padding: 16,
        overflowY: "auto",
        flexShrink: 0,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
          <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: 2 }}>
            {node.id}
          </div>
        </div>
        <button onClick={onClose} style={{ fontSize: "1.1rem", lineHeight: 1, padding: "0 4px" }}>
          ×
        </button>
      </div>

      {/* Cluster */}
      {node.clusterId && (
        <div style={{ fontSize: "0.8rem" }}>
          <span style={{ color: "#6b7280" }}>Cluster </span>
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
        <p style={{ fontSize: "0.8rem", color: "#9ca3af" }}>Loading…</p>
      ) : detail ? (
        <p
          style={{
            fontSize: "0.8rem",
            color: "#374151",
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
          <div style={{ fontWeight: 600, color: "#b45309" }}>
            Decay: {node.decayScore.toFixed(2)}
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "#92400e" }}>
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
                background: "#f1f5f9",
                padding: "6px 8px",
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              <div>
                <strong>{r.type}:</strong> {r.suggestion}
              </div>
              <div style={{ color: "#6b7280", marginTop: 2 }}>{r.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
