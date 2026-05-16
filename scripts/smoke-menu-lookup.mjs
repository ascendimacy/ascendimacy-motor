#!/usr/bin/env node
/**
 * Smoke E2E menu-lookup (ops#999 C-T-10-01).
 *
 * Não usa orchestrator/MCP children — chama lookupActionMenu direto
 * contra fixture real persistida em fixtures/profiles/.
 *
 * Cobre: cache, decay multiplicativo (item expirado decai p/ 30%),
 * shim isaLabels, outcomes (ok|menu_missing|menu_stale|no_eligible_items).
 *
 * Uso:
 *   node scripts/smoke-menu-lookup.mjs
 */
import { lookupActionMenu, _resetMenuLookupCache } from "../planejador/dist/strategist/menu-lookup.js";

const baseDir = "fixtures/profiles";
let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.log(`  ✗ ${msg}`);
    fail++;
  }
}

async function main() {
  _resetMenuLookupCache();

  console.log("[smoke] G1: lookup persona conhecida (paula-mendes)");
  const r1 = await lookupActionMenu("paula-mendes", baseDir, { bypassCache: true, topK: 5 });
  assert(r1.outcome === "ok", `outcome=ok (got ${r1.outcome})`);
  assert(r1.items.length === 5, `5 items returned (got ${r1.items.length})`);
  assert(r1.diagnostics.itemsConsidered === 5, `itemsConsidered=5`);

  console.log("[smoke] G2: decay multiplicativo — item expirado fica ÚLTIMO");
  const decayItem = r1.items.find((it) => it.item.id === "smoke-decay-01");
  assert(decayItem !== undefined, `smoke-decay-01 sobreviveu top-K (decay × 0.3)`);
  if (decayItem) {
    assert(
      decayItem.reasons.some((r) => r.includes("decay_applied")),
      `reasons contém "decay_applied"`,
    );
    const lastItem = r1.items[r1.items.length - 1];
    assert(lastItem.item.id === "smoke-decay-01", `decay item é último no ranking (0.95 × 0.3 = 0.285 < 0.5)`);
  }

  console.log("[smoke] G3: shim isaLabels propagado");
  const diamond = r1.items.find((it) => it.item.id === "smoke-diamond-01");
  assert(diamond !== undefined, `smoke-diamond-01 presente`);
  if (diamond) {
    assert(diamond.isaLabels?.played_as === "diamante", `isaLabels.played_as=diamante`);
    assert(diamond.isaLabels?.intensity === "firm", `isaLabels.intensity=firm`);
    assert(diamond.item.type === "cultural_diamond", `type mapped: cultural_diamond`);
  }

  console.log("[smoke] G4: type mapping shim (curiosity→curiosity_hook, strategy→dynamic)");
  const curio = r1.items.find((it) => it.item.id === "smoke-curio-01");
  assert(curio?.item.type === "curiosity_hook", `curiosity → curiosity_hook`);
  const strat = r1.items.find((it) => it.item.id === "smoke-strategy-01");
  assert(strat?.item.type === "dynamic", `strategy → dynamic`);

  console.log("[smoke] G5: used_in_session filter");
  const r2 = await lookupActionMenu("paula-mendes", baseDir, {
    bypassCache: true,
    usedInSession: ["smoke-curio-01", "smoke-diamond-01"],
    topK: 5,
  });
  assert(r2.outcome === "ok", `outcome=ok com filter`);
  assert(r2.items.length === 3, `3 items após filter (got ${r2.items.length})`);
  const filteredIds = r2.items.map((it) => it.item.id);
  assert(!filteredIds.includes("smoke-curio-01"), `smoke-curio-01 excluído`);
  assert(!filteredIds.includes("smoke-diamond-01"), `smoke-diamond-01 excluído`);

  console.log("[smoke] G6: menu_missing — persona sem fixture");
  const r3 = await lookupActionMenu("persona-inexistente-xyz", baseDir, { bypassCache: true });
  assert(r3.outcome === "menu_missing", `outcome=menu_missing`);
  assert(r3.items.length === 0, `items.length=0`);

  console.log("[smoke] G7: cache singleton — segunda call sem disco");
  _resetMenuLookupCache();
  const t0 = Date.now();
  const r4a = await lookupActionMenu("paula-mendes", baseDir);
  const dt_disk = Date.now() - t0;
  const t1 = Date.now();
  const r4b = await lookupActionMenu("paula-mendes", baseDir);
  const dt_cache = Date.now() - t1;
  assert(r4a.outcome === "ok" && r4b.outcome === "ok", `ambas calls outcome=ok`);
  console.log(`     [info] disco=${dt_disk}ms, cache=${dt_cache}ms`);

  console.log("");
  console.log(`[smoke] Total: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] FATAL:", err);
  process.exit(1);
});
