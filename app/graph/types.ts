import type { RefinementSuggestion } from "@/types/refinement";
import type { RelationType } from "@/types/relation";

export interface GraphNode {
  id: string;
  title: string;
  clusterId: string | null;
  decayScore: number;
  decayReasons: string[];
  refinements: RefinementSuggestion[];
  linkCount: number;
  isMeta: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  relationType: RelationType | null;
  isTension: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  clusterIds: string[];
}
