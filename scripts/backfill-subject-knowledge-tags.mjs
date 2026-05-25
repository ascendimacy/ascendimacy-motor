#!/usr/bin/env node
/**
 * Backfill mecânico das tags Subject Knowledge nos content seeds.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-subject-knowledge-bridge.md §3, §4.4
 *
 * Adiciona axis_id, family, lineage_anchor, extracted_keywords pra cada
 * item de content/hooks/seed.json que não tenha — habilitando o
 * ConceptLedgerWriter (+1pt) e o scorer multi-dim (bonus combinatorial).
 *
 * Heurística v1:
 *  - casel_target → axis_id (lookup)
 *  - axis_id → family (1-4=carater, 5-8=disposicao, 9-12=cognicao_si)
 *  - domain → lineage_anchor (default por área cultural)
 *  - extracted_keywords: top palavras-chave do fact (>4 chars, sem stopwords)
 *
 * Idempotente: items que já têm axis_id são pulados.
 *
 * Uso:
 *   node scripts/backfill-subject-knowledge-tags.mjs [path/to/seed.json]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SEED_PATH = path.join(REPO_ROOT, "content/hooks/seed.json");

// CASEL → axis_id (mapeamento conservador)
// SA self-awareness  → autoconhecimento (11)
// SM self-management → temperança (4)
// SOC social-aware   → compaixão (7)
// REL relationships  → compaixão (7)
// DM decision-making → prudência (1)
const CASEL_TO_AXIS = {
  SA: 11,
  SM: 4,
  SOC: 7,
  REL: 7,
  DM: 1,
};

// Override por domain quando casel é ambíguo (escolhe axis mais alinhado
// à natureza do conteúdo, não só ao CASEL).
const DOMAIN_AXIS_OVERRIDE = {
  philosophy: 1, // Prudência
  history: 2, // Justiça
  myth: 3, // Fortaleza
  mythology: 3,
  ethics: 2,
  arts: 10, // Curiosidade
  music: 7, // Compaixão
  art: 10,
  geography: 10,
  nature: 10,
};

// Family from axis_id
function familyForAxis(axisId) {
  if (axisId >= 1 && axisId <= 4) return "carater";
  if (axisId >= 5 && axisId <= 8) return "disposicao";
  if (axisId >= 9 && axisId <= 12) return "cognicao_si";
  return undefined;
}

// Default lineage_anchor por axis_id (escolha conservadora; usuário pode
// refinar item-a-item depois). Cada eixo aponta pra um complemento de
// tradição plural — não tendencia uma só tradição.
const DEFAULT_LINEAGE_PER_AXIS = {
  1: "aristotelica/phronesis",
  2: "aristotelica/justica_aristotelica",
  3: "paideia/andreia",
  4: "paideia/sophrosyne",
  5: "estoica/assentir_estoico",
  6: "estoica/amor_fati",
  7: "hebraica/hesed",
  8: "estoica/prosoche_estoica",
  9: "paideia/aletheia",
  10: "paideia/thaumazein",
  11: "paideia/gnothi_seauton",
  12: "estoica/dicotomia_controle_responsabilidade",
};

// Stopwords PT-BR + EN (usados em facts) pra filtrar do keyword extraction
const STOPWORDS = new Set([
  "para", "como", "mais", "menos", "esse", "essa", "isso", "esses", "essas",
  "este", "esta", "isto", "estes", "estas", "aquele", "aquela", "aquilo",
  "depois", "antes", "agora", "ainda", "muito", "pouco", "todos", "todas",
  "nada", "nunca", "sempre", "porque", "quando", "onde", "qual", "quem",
  "também", "tambem", "então", "entao", "assim", "outro", "outra", "outros",
  "outras", "mesmo", "mesma", "mesmos", "mesmas", "cada", "tudo", "toda",
  "the", "this", "that", "with", "from", "have", "they", "their", "them",
  "into", "what", "when", "where", "which", "while", "would", "could",
  "should", "about", "after", "before", "than",
  // grammar particles
  "uma", "umas", "uns", "dos", "das", "nos", "nas", "nem", "pra", "por",
  "sem", "sob", "sobre", "entre", "contra", "ate", "até", "ja", "já", "vai",
  "ser", "tem", "tens", "estar", "está", "estão", "foram", "foi", "era",
  "são", "sao", "fica", "ficar", "ficou", "ficam",
]);

function extractKeywords(item) {
  // Junta fact + bridge + quest (se existir) pra ter mais sinal
  const text = [item.fact, item.bridge, item.quest]
    .filter((x) => typeof x === "string")
    .join(" ");

  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 4 && !STOPWORDS.has(t));

  // Frequency-ranked, top 5 únicos
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  return sorted.slice(0, 5);
}

function inferTags(item) {
  // axis_id: domain override > casel mapping > fallback
  let axisId = DOMAIN_AXIS_OVERRIDE[item.domain];
  if (axisId === undefined) {
    const firstCasel = Array.isArray(item.casel_target) ? item.casel_target[0] : undefined;
    if (firstCasel && CASEL_TO_AXIS[firstCasel] !== undefined) {
      axisId = CASEL_TO_AXIS[firstCasel];
    }
  }
  if (axisId === undefined) return null; // skip: não foi possível inferir

  const family = familyForAxis(axisId);
  const lineage = DEFAULT_LINEAGE_PER_AXIS[axisId];
  const keywords = extractKeywords(item);
  if (keywords.length === 0) return null;

  return {
    axis_id: axisId,
    family,
    lineage_anchor: lineage,
    extracted_keywords: keywords,
  };
}

function main() {
  const seedPath = path.resolve(process.argv[2] ?? DEFAULT_SEED_PATH);

  if (!fs.existsSync(seedPath)) {
    console.error(`[backfill] seed not found: ${seedPath}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(seedPath, "utf8");
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) {
    console.error("[backfill] seed root must be an array");
    process.exit(2);
  }

  let backfilled = 0;
  let skipped = 0;
  let unable = 0;
  const familyBreakdown = { carater: 0, disposicao: 0, cognicao_si: 0 };

  for (const item of items) {
    if (item.axis_id !== undefined) {
      skipped += 1;
      continue;
    }
    const tags = inferTags(item);
    if (tags === null) {
      unable += 1;
      continue;
    }
    item.axis_id = tags.axis_id;
    item.family = tags.family;
    item.lineage_anchor = tags.lineage_anchor;
    item.extracted_keywords = tags.extracted_keywords;
    backfilled += 1;
    familyBreakdown[tags.family] = (familyBreakdown[tags.family] ?? 0) + 1;
  }

  fs.writeFileSync(seedPath, JSON.stringify(items, null, 2) + "\n", "utf8");

  console.log(`[backfill] seed: ${seedPath}`);
  console.log(`[backfill] total items: ${items.length}`);
  console.log(`[backfill] backfilled: ${backfilled}`);
  console.log(`[backfill] skipped (already tagged): ${skipped}`);
  console.log(`[backfill] unable (no casel/no domain match): ${unable}`);
  console.log(`[backfill] family breakdown:`);
  for (const [fam, count] of Object.entries(familyBreakdown)) {
    console.log(`           ${fam}: ${count}`);
  }
}

main();
