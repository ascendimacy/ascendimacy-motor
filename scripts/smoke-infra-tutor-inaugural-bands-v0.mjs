#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0.2.7-bands (inaugural por idade)
 *
 * Valida `motor-drota/src/inaugural.ts:buildInaugural` no path BR
 * dispatch por banda etária:
 *   - age < 10  → buildSoloBrLudic ("super-poderes", "jogar")
 *   - 10-14    → buildSoloBr direct ("diferente de professor", "atividade rápida")
 *   - age >= 15 → buildSoloBrPhil ("forma mais antiga de educação")
 *
 * Estrutura comum (6 ingredientes) é assegurada em todas as bandas.
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-drota
 *   node scripts/smoke-infra-tutor-inaugural-bands-v0.mjs
 */

let pass = 0;
let fail = 0;
let bypass = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else { console.log(`  ✗ ${msg}`); fail++; }
}

function recordBypass(msg) {
  console.log(`  ○ ${msg} (bypass)`);
  bypass++;
}

async function main() {
  const { buildInaugural } = await import("../motor-drota/dist/inaugural.js");

  console.log("[smoke-infra] Tutor Inaugural Bands — dispatch por idade no path BR\n");

  function buildCtx(age) {
    return {
      personaName: "Test",
      personaAge: age,
      profileId: "test-persona",
      sessionNumber: 1,
      isJoint: false,
    };
  }

  // ─── G1: age 8 → ludic ────────────────────────────────────────────────
  console.log("[smoke-infra] G1: age=8 → buildSoloBrLudic (super-poderes/jogar)");
  const r1 = await buildInaugural(buildCtx(8));
  assert(r1.template_used === "inaugural_solo_br_tutor_intro_ludic_v027", `template ludic (got ${r1.template_used})`);
  assert(r1.text.includes("super-poderes"), "texto contém 'super-poderes' (vocabulário lúdico)");
  assert(r1.text.includes("jogar"), "texto contém 'jogar' (atividade lúdica)");
  assert(r1.text.includes("baralho"), "menciona baralho (artefato)");
  assert(r1.text.includes("Sou um tutor"), "declara identidade de tutor");
  assert(
    r1.text.toLowerCase().includes("se for chato"),
    "consent gate ('se for chato')",
  );

  // ─── G2: age 12 → direct ──────────────────────────────────────────────
  console.log("\n[smoke-infra] G2: age=12 → buildSoloBr direct (Ryo/Kei band)");
  const r2 = await buildInaugural(buildCtx(12));
  assert(r2.template_used === "inaugural_solo_br_tutor_intro_direct_v027", `template direct (got ${r2.template_used})`);
  assert(r2.text.includes("Diferente de professor"), "texto contém 'Diferente de professor' (direct framing)");
  assert(r2.text.includes("4 virtudes"), "texto contém '4 virtudes'");
  assert(r2.text.includes("Sou um tutor"), "declara identidade de tutor");
  assert(
    r2.text.toLowerCase().includes("se você não curtir") || r2.text.toLowerCase().includes("se não curtir"),
    "consent gate ('se não curtir')",
  );

  // ─── G3: age 17 → philosophical ───────────────────────────────────────
  console.log("\n[smoke-infra] G3: age=17 → buildSoloBrPhil (filosófico)");
  const r3 = await buildInaugural(buildCtx(17));
  assert(r3.template_used === "inaugural_solo_br_tutor_intro_phil_v027", `template phil (got ${r3.template_used})`);
  assert(
    r3.text.includes("forma mais antiga de educação"),
    "texto contém 'forma mais antiga de educação' (framing histórico)",
  );
  assert(r3.text.includes("ética clássica"), "menciona ética clássica");
  assert(r3.text.includes("4 virtudes"), "menciona 4 virtudes");
  assert(r3.text.includes("Sou um tutor"), "declara identidade de tutor");
  assert(
    r3.text.toLowerCase().includes("se não rolar"),
    "consent gate ('se não rolar')",
  );

  // ─── G4: age=0 ou indefinido → fallback direct ────────────────────────
  console.log("\n[smoke-infra] G4: age desconhecida → fallback direct");
  const r4 = await buildInaugural(buildCtx(0));
  assert(r4.template_used === "inaugural_solo_br_tutor_intro_direct_v027", "fallback usa banda direct");

  // ─── G5: bordas 10 e 14 → direct ──────────────────────────────────────
  console.log("\n[smoke-infra] G5: bordas 10 e 14 → direct (não-ludic, não-phil)");
  const r5a = await buildInaugural(buildCtx(10));
  const r5b = await buildInaugural(buildCtx(14));
  assert(r5a.template_used === "inaugural_solo_br_tutor_intro_direct_v027", "age=10 → direct");
  assert(r5b.template_used === "inaugural_solo_br_tutor_intro_direct_v027", "age=14 → direct");

  // ─── G6: borda 15 → philosophical ─────────────────────────────────────
  console.log("\n[smoke-infra] G6: age=15 → philosophical");
  const r6 = await buildInaugural(buildCtx(15));
  assert(r6.template_used === "inaugural_solo_br_tutor_intro_phil_v027", "age=15 → phil");

  // ─── G7: borda age=9 → ludic ──────────────────────────────────────────
  console.log("\n[smoke-infra] G7: age=9 → ludic");
  const r7 = await buildInaugural(buildCtx(9));
  assert(r7.template_used === "inaugural_solo_br_tutor_intro_ludic_v027", "age=9 → ludic");

  // ─── G8: todas bandas declaram non_evaluation_clause + exit_right ─────
  console.log("\n[smoke-infra] G8: invariantes — non_eval + exit_right em todas as bandas");
  for (const r of [r1, r2, r3]) {
    assert(r.non_evaluation_clause_present === true, `${r.template_used}: non_evaluation_clause_present`);
    assert(r.exit_right_present === true, `${r.template_used}: exit_right_present`);
  }

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
