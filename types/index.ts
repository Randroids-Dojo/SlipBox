export type {
  NoteId,
  NoteType,
  NoteMetadata,
  NoteLink,
  Note,
  CreateNoteInput,
} from "./note";

export type {
  EmbeddingVector,
  NoteEmbedding,
  EmbeddingsIndex,
} from "./embedding";
export { emptyEmbeddingsIndex } from "./embedding";

export type { BacklinksIndex } from "./graph";
export { emptyBacklinksIndex } from "./graph";

export type { Cluster, ClustersIndex } from "./cluster";
export { emptyClustersIndex } from "./cluster";

export type { Tension, TensionsIndex } from "./tension";
export { emptyTensionsIndex } from "./tension";
