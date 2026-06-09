// Shared types used across the ipyflow labextension.

export type CellId = string;

export type Highlights = 'all' | 'none' | 'executed' | 'reactive';

/** Adjacency map: cell id -> list of related cell ids (parents or children). */
export type EdgeMap = { [id: CellId]: CellId[] };

/** Two-level adjacency map keyed by an outer then inner cell id. */
export type NestedEdgeMap = { [id: CellId]: { [id2: CellId]: CellId[] } };

export type CellMetadata = {
  index: number;
  content: string;
  type: string;
};

export type CellMetadataMap = { [id: CellId]: CellMetadata };

/**
 * Settings pushed from the kernel. Known keys are spelled out for readability;
 * the index signature keeps it tolerant of additional keys the kernel may send.
 */
export interface ISettings {
  exec_mode?: string;
  reactivity_mode?: string;
  flow_order?: string;
  exec_schedule?: string;
  color_scheme?: string;
  pull_reactive_updates?: boolean;
  push_reactive_updates_to_cousins?: boolean;
  [key: string]: string | boolean | undefined;
}
