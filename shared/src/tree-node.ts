/**
 * Tree node — unidade de persistência genérica do motor canônico.
 *
 * Inspirado em `ebrota/src/kids/tree.js` (§17 FOUNDATION, "Árvore Viva"),
 * porém minimalista no v1: é usado só para status matrix em Bloco 2a.
 * Zonas raiz/tronco/galho/folha virão em C-005 (migração da árvore).
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.C (v2).
 * Referência: ebrota/src/kids/tree.js:6-41 (constantes).
 */

export const TREE_NODE_ZONES = [
  "status",
  "raiz",
  "tronco",
  "galho",
  "folha",
] as const;
export type TreeNodeZone = (typeof TREE_NODE_ZONES)[number];

export const NODE_STATES = [
  "seed",
  "done",
  "partial",
  "empty",
  "warning",
  "refused",
  "review",
  "muted",
] as const;
export type NodeState = (typeof NODE_STATES)[number];

export const SENSITIVITIES = ["free", "conversation", "protected"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** Node fields as persisted (subset mirror of kids_tree_nodes). */
export interface TreeNode {
  id?: number;
  sessionId: string;
  zone: TreeNodeZone;
  key: string;
  value: string | null;
  source: string;
  state: NodeState;
  sensitivity: Sensitivity;
  urgency: number;
  importance: number;
  halfLifeDays: number | null;
  lastActiveAt: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isTreeNodeZone(v: unknown): v is TreeNodeZone {
  return typeof v === "string" && TREE_NODE_ZONES.includes(v as TreeNodeZone);
}

export function isNodeState(v: unknown): v is NodeState {
  return typeof v === "string" && NODE_STATES.includes(v as NodeState);
}

export function isSensitivity(v: unknown): v is Sensitivity {
  return typeof v === "string" && SENSITIVITIES.includes(v as Sensitivity);
}
