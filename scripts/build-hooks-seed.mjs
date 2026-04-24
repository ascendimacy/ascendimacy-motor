#!/usr/bin/env node
/**
 * Converte ebrota/playbooks/CURIOSITY_HOOKS_BANK.MD em JSON seed de
 * curiosity_hooks no schema ContentItem unificado (shared/src/content-item.ts).
 *
 * Uso: node scripts/build-hooks-seed.mjs <path/to/CURIOSITY_HOOKS_BANK.MD> <out.json>
 *
 * Handoff #17 Bloco 1.4.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SECTION_TO_DOMAIN = {
  "1": "linguistics",
  "2": "biology",
  "3": "physiology",
  "4": "physics",
  "5": "geography",
  "6": "history",
  "7": "psychology",
  "8": "culture",
  "9": "mathematics",
  "10": "mythology",
  "11": "theology",
  "12": "symbology",
  "13": "military",
  "14": "business",
  "15": "chemistry",
  "16": "ideology",
  "17": "computing",
};

// CASEL do banco → canonical SOC/REL/SA/SM/DM.
// O banco usa a notação canonical; este mapa é só defensivo.
const CASEL_MAP = {
  SA: "SA",
  SM: "SM",
  SOC: "SOC",
  REL: "REL",
  DM: "DM",
};

/**
 * Parse bruto do bloco `{ ... }`. Extrai string entre aspas simples por chave,
 * tolerando aspas simples escapadas e quebras de linha internas.
 */
function extractField(block, field) {
  // Busca `<field>:` seguido de uma string com aspas simples. Greedy até o
  // próximo `'` que não é escapado.
  const re = new RegExp(
    `${field}\\s*:\\s*'((?:\\\\'|[^'])*)'`,
    "s",
  );
  const m = block.match(re);
  if (!m) return null;
  return m[1].replace(/\\'/g, "'");
}

function extractNumber(block, field) {
  const re = new RegExp(`${field}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = block.match(re);
  return m ? Number(m[1]) : null;
}

function extractBool(block, field) {
  const re = new RegExp(`${field}\\s*:\\s*(true|false)`);
  const m = block.match(re);
  return m ? m[1] === "true" : null;
}

function parseHookBlock(block, domain) {
  const id = extractField(block, "id");
  if (!id) return null;

  const fact = extractField(block, "fact");
  const bridge = extractField(block, "bridge");
  const quest = extractField(block, "quest");
  const casel_raw = extractField(block, "casel");
  const sacrifice_type = extractField(block, "sacrifice_type");
  const country = extractField(block, "country");
  const surprise = extractNumber(block, "surprise") ?? 7;
  const verified = extractBool(block, "verified") ?? false;

  const casel = casel_raw && CASEL_MAP[casel_raw] ? CASEL_MAP[casel_raw] : null;

  if (!fact || !bridge || !quest || !casel || !sacrifice_type) {
    return { __skipped: true, id, reason: "missing_required_field" };
  }

  return {
    id,
    type: "curiosity_hook",
    domain,
    casel_target: [casel],
    age_range: [7, 14],
    surprise,
    verified,
    base_score: 7,
    fact,
    bridge,
    quest,
    sacrifice_type,
    ...(country ? { country } : {}),
  };
}

function parse(md) {
  const lines = md.split("\n");
  const items = [];
  const skipped = [];

  let currentDomain = null;
  let inCodeBlock = false;
  let buffer = [];
  let braceDepth = 0;

  function flushObject() {
    const block = buffer.join("\n");
    buffer = [];
    if (!currentDomain) return;
    const item = parseHookBlock(block, currentDomain);
    if (!item) return;
    if (item.__skipped) {
      skipped.push(item);
      return;
    }
    items.push(item);
  }

  for (const rawLine of lines) {
    const line = rawLine;

    const sectionMatch = line.match(/^##\s+(\d+)\.\s/);
    if (sectionMatch) {
      currentDomain = SECTION_TO_DOMAIN[sectionMatch[1]] ?? null;
      continue;
    }

    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      buffer = [];
      braceDepth = 0;
      continue;
    }

    if (!inCodeBlock) continue;

    // Contagem de chaves apenas nas linhas relevantes ({ e }, fora de strings).
    // Heurística simples: só consideramos `{` no início de uma linha e `},` ou
    // `}` no fim. Suficiente para o formato do bank.
    if (/^\s*\{\s*$/.test(line)) {
      braceDepth = 1;
      buffer = [];
      continue;
    }

    if (braceDepth > 0) {
      buffer.push(line);
      if (/^\s*\},?\s*$/.test(line)) {
        braceDepth = 0;
        flushObject();
      }
    }
  }

  return { items, skipped };
}

function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg || !outputArg) {
    console.error(
      "uso: node scripts/build-hooks-seed.mjs <CURIOSITY_HOOKS_BANK.MD> <out.json>",
    );
    process.exit(2);
  }
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);

  const md = fs.readFileSync(inputPath, "utf8");
  const { items, skipped } = parse(md);

  const seenIds = new Set();
  const duplicates = [];
  for (const item of items) {
    if (seenIds.has(item.id)) duplicates.push(item.id);
    seenIds.add(item.id);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2) + "\n", "utf8");

  console.log(
    `[build-hooks-seed] parsed=${items.length} skipped=${skipped.length} duplicates=${duplicates.length}`,
  );
  console.log(`[build-hooks-seed] wrote ${outputPath}`);
  if (skipped.length) {
    for (const s of skipped) {
      console.warn(`  skipped ${s.id}: ${s.reason}`);
    }
  }
  if (duplicates.length) {
    console.warn(`  duplicates: ${duplicates.join(", ")}`);
    process.exit(1);
  }
}

main();
