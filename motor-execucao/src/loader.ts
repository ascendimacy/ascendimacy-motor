import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { PlaybookInventory, PlaybookEntry } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadInventory(inventoryPath?: string): PlaybookInventory {
  const defaultPath = join(__dirname, "../../fixtures/ebrota-inventario-v1.yaml");
  const path = inventoryPath ?? defaultPath;
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown>;
  return normalizeInventory(parsed);
}

function normalizeInventory(raw: Record<string, unknown>): PlaybookInventory {
  const entries = Array.isArray(raw["playbooks"]) ? raw["playbooks"] : [];
  const playbooks: PlaybookEntry[] = entries.slice(0, 10).map((p: Record<string, unknown>, i: number) => ({
    id: String(p["id"] ?? p["name"] ?? `playbook-${i}`),
    title: String(p["title"] ?? p["name"] ?? "untitled"),
    category: String(p["category"] ?? "general"),
    triggers: Array.isArray(p["triggers"]) ? p["triggers"].map(String) : [],
    content: String(p["content"] ?? p["description"] ?? ""),
    estimatedSacrifice: Number(p["estimated_sacrifice"] ?? 2),
    estimatedConfidenceGain: Number(p["estimated_confidence_gain"] ?? 3),
  }));
  return { version: String(raw["version"] ?? "1.0"), playbooks };
}

export function getPlaybookById(inventory: PlaybookInventory, id: string): PlaybookEntry | undefined {
  return inventory.playbooks.find(p => p.id === id);
}
