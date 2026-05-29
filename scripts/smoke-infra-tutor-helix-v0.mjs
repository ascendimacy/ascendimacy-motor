#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 2 - CP8 - Item 12)
 *
 * Valida que o pragmatic-selector aplica tie-break por par CASEL ativo do
 * Double Helix quando o `move_type` é `correct` ou `recall`. Em outros
 * move_types, sort permanece cost → score (sem mudança).
 *
 * Testa pragmatic-selector.selectAction diretamente com items mockados
 * (escopo unit infra) — não roda planTurn nem o pipeline completo.
 *
 * Cobertura:
 * - Item 12: integração com Double Helix (tie-break pedagógico)
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador && \
 *   npm run build --workspace motor-drota
 *   node scripts/smoke-infra-tutor-helix-v0.mjs
 */

let pass = 0;
let fail = 0;
let bypass = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.log(`  ✗ ${msg}`);
    fail++;
  }
}

function recordBypass(msg) {
  console.log(`  ○ ${msg} (bypass)`);
  bypass++;
}

async function main() {
  const { selectAction } = await import("../motor-drota/dist/pragmatic-selector.js");

  console.log("[smoke-infra] Tutor Helix — pragmatic-selector tie-break (CP8)\n");

  const mkItem = (id, casel_target, cost, score = 0.5) => ({
    item: { id, sacrifice_amount: cost, casel_target },
    score,
    reasons: [],
  });

  const mockAssessment = { mood: 5, engagement: "engaging", signals: [] };
  const mockState = {
    sessionId: "smoke-helix",
    trustLevel: 0.5,
    budgetRemaining: 50,
    turn: 4,
    eventLog: [],
  };

  // ─── G1: correct + active_pair → item alinhado vence empate ─────────────
  console.log("[smoke-infra] G1: correct + active_pair=[SA,SOC] → item alinhado vence empate de custo/score");
  const poolG1 = [
    mkItem("noMatch", ["RD", "RM"], 3, 0.5),       // primeiro na ordem mas sem overlap
    mkItem("matchA", ["SA", "RD"], 3, 0.5),         // alinhado SA
    mkItem("matchB", ["SOC", "RM"], 3, 0.5),        // alinhado SOC
  ];
  const r1 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "correct",
  });
  assert(r1.selected?.item.id === "matchA", `correct: matchA vence (got ${r1.selected?.item.id})`);

  // ─── G2: recall + active_pair → mesmo comportamento ─────────────────────
  console.log("\n[smoke-infra] G2: recall + active_pair → item alinhado vence");
  const r2 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "recall",
  });
  assert(r2.selected?.item.id === "matchA", `recall: matchA vence (got ${r2.selected?.item.id})`);

  // ─── G3: explain → tie-break NÃO aplicado, fallback de score ────────────
  console.log("\n[smoke-infra] G3: explain → sem tie-break helix; fallback cost→score");
  const r3 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "explain",
  });
  // Sort estável: cost igual, score igual → mantém ordem do array → noMatch vence
  assert(r3.selected?.item.id === "noMatch", `explain: noMatch vence (ordem original, sem helix) (got ${r3.selected?.item.id})`);

  // ─── G4: close → mesmo (sem tie-break helix) ───────────────────────────
  console.log("\n[smoke-infra] G4: close → sem tie-break helix");
  const r4 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "close",
  });
  assert(r4.selected?.item.id === "noMatch", `close: noMatch vence (got ${r4.selected?.item.id})`);

  // ─── G5: helixActivePair ausente → sem tie-break ───────────────────────
  console.log("\n[smoke-infra] G5: helixActivePair ausente → tie-break não aplicado mesmo com correct");
  const r5 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    tutorialMoveType: "correct",
    // helixActivePair: undefined
  });
  assert(r5.selected?.item.id === "noMatch", `sem helix: noMatch vence (got ${r5.selected?.item.id})`);

  // ─── G6: helixActivePair vazio → sem tie-break ─────────────────────────
  console.log("\n[smoke-infra] G6: helixActivePair=[] → tie-break não aplicado");
  const r6 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: [],
    tutorialMoveType: "correct",
  });
  assert(r6.selected?.item.id === "noMatch", `helix vazio: noMatch vence (got ${r6.selected?.item.id})`);

  // ─── G7: nenhum item alinhado → fallback de score (sem efeito helix) ────
  console.log("\n[smoke-infra] G7: nenhum item alinhado → fallback estável");
  const poolG7 = [
    mkItem("rd", ["RD"], 3, 0.5),
    mkItem("rm", ["RM"], 3, 0.5),
  ];
  const r7 = selectAction({
    candidates: poolG7,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "correct",
  });
  assert(r7.selected?.item.id === "rd", `sem alinhados: ordem original (got ${r7.selected?.item.id})`);

  // ─── G8: cost diferente → cost vence; helix não substitui ───────────────
  console.log("\n[smoke-infra] G8: cost diferente → cost vence (helix não substitui)");
  const poolG8 = [
    mkItem("expensiveMatch", ["SA"], 5, 0.5),
    mkItem("cheapNoMatch", ["RD"], 2, 0.5),
  ];
  const r8 = selectAction({
    candidates: poolG8,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "correct",
  });
  assert(
    r8.selected?.item.id === "cheapNoMatch",
    `cost vence: cheapNoMatch (got ${r8.selected?.item.id})`,
  );

  // ─── G9: item sem casel_target → tratado como não-alinhado ──────────────
  console.log("\n[smoke-infra] G9: item sem casel_target → matchesHelix=false (não-alinhado)");
  const poolG9 = [
    mkItem("noCaselField", undefined, 3, 0.5),
    mkItem("alignedSA", ["SA"], 3, 0.5),
  ];
  const r9 = selectAction({
    candidates: poolG9,
    assessment: mockAssessment,
    state: mockState,
    helixActivePair: ["SA", "SOC"],
    tutorialMoveType: "correct",
  });
  assert(r9.selected?.item.id === "alignedSA", `sem casel_target: alinhado vence (got ${r9.selected?.item.id})`);

  // ─── G10: backward compat — chamada sem novos campos não muda nada ─────
  console.log("\n[smoke-infra] G10: chamada sem novos campos = comportamento legado preservado");
  const r10 = selectAction({
    candidates: poolG1,
    assessment: mockAssessment,
    state: mockState,
    // sem helixActivePair, sem tutorialMoveType
  });
  assert(r10.selected?.item.id === "noMatch", `legado: ordem original (got ${r10.selected?.item.id})`);

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
