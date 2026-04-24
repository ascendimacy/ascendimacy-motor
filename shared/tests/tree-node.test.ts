import { describe, it, expect } from "vitest";
import {
  isTreeNodeZone,
  isNodeState,
  isSensitivity,
  TREE_NODE_ZONES,
  NODE_STATES,
  SENSITIVITIES,
} from "../src/tree-node.js";

describe("TreeNode zones", () => {
  it("accepts canonical zones", () => {
    for (const z of TREE_NODE_ZONES) {
      expect(isTreeNodeZone(z)).toBe(true);
    }
  });
  it("rejects unknown strings", () => {
    expect(isTreeNodeZone("root")).toBe(false);
    expect(isTreeNodeZone("")).toBe(false);
    expect(isTreeNodeZone(42)).toBe(false);
  });
  it("includes status zone (Bloco 2a)", () => {
    expect(TREE_NODE_ZONES).toContain("status");
  });
});

describe("NodeState guard", () => {
  it("accepts all 8 canonical states", () => {
    for (const s of NODE_STATES) {
      expect(isNodeState(s)).toBe(true);
    }
    expect(NODE_STATES.length).toBe(8);
  });
  it("rejects invalid states", () => {
    expect(isNodeState("active")).toBe(false);
  });
});

describe("Sensitivity guard", () => {
  it("accepts free|conversation|protected", () => {
    for (const s of SENSITIVITIES) {
      expect(isSensitivity(s)).toBe(true);
    }
  });
  it("rejects others", () => {
    expect(isSensitivity("public")).toBe(false);
  });
});
