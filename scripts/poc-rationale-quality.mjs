#!/usr/bin/env node
/**
 * PoC qualitativo — compara rationale "Baked" (do menu fixture) vs "Fresh"
 * (gerado por Qwen3 com prompt real do planejador). Para cada rationale,
 * drota compõe via Qwen3 com mesmo selected_content. Output: handoff
 * markdown lado-a-lado pra review humano.
 *
 * Categoria: PoC qualitativo. Distinto de:
 *   - Unit/Smoke (pass/fail)
 *   - Benchmark (quantitativo: cost, latency)
 *
 * Pergunta que responde: "rationale baked é bom o suficiente vs rationale
 * gerado fresh, ou degrada drota output a ponto de comprometer pedagogia?"
 *
 * Implementação: usa poc-runner.mjs (framework reutilizável). Variant A = Baked
 * (lê fixture, 0 LLM calls de setup), Variant B = Fresh (1 Qwen3 call no
 * planejador prompt).
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT.
 *
 * Uso:
 *   node scripts/poc-rationale-quality.mjs [--persona ryo|paula]
 *
 * Tempo: ~15min por persona (3 Qwen3 calls: 1 rationale fresh + 2 drota A/B).
 */

import { runPoc } from "./poc-runner.mjs";

const argv = process.argv.slice(2);
const PERSONA_KEY = argv[argv.indexOf("--persona") + 1] ?? "ryo";

const PERSONAS = {
  ryo: {
    id: "ryo-ochiai",
    name: "Ryo",
    age: 11,
    profile: { interests: ["tênis", "dragon_ball"], deflective: true },
  },
  paula: {
    id: "paula-mendes",
    name: "Paula",
    age: 10,
    profile: { interests: ["natureza", "histórias"] },
  },
};

async function main() {
  const persona = PERSONAS[PERSONA_KEY];
  if (!persona) throw new Error(`unknown persona: ${PERSONA_KEY}`);

  // Env vars precisam estar setadas ANTES dos dynamic imports do runner
  process.env.ASC_USE_ACTION_MENU = "true";
  process.env.ASC_ACTION_MENU_BASE_DIR = "fixtures/profiles";

  // Carregar planejador + menu-lookup (não vêm com o runner — específicos do
  // setup deste PoC pra gerar rationale Fresh e ler menu Baked).
  const { buildSystemPrompt } = await import("../planejador/dist/plan.js");
  const { lookupActionMenu } = await import(
    "../planejador/dist/strategist/menu-lookup.js"
  );

  // Closure captura buildSystemPrompt + lookupActionMenu + persona pro spec
  const sharedCtx = {};

  await runPoc({
    pocName: "rationale-quality",
    persona,
    variantNames: ["A_baked", "B_fresh"],

    async setupVariants(deps) {
      // ─── Variant A: Baked (lê fixture, 0 LLM calls) ─────────────────
      console.log("  [setup] Lookup menu (Baked)...");
      const menuResult = await lookupActionMenu(persona.id, "fixtures/profiles", {
        topK: 5,
        bypassCache: true,
      });
      if (menuResult.outcome !== "ok") {
        throw new Error(`menu lookup failed: outcome=${menuResult.outcome}`);
      }
      const bakedRationale = menuResult.source?.strategic_rationale;
      const bakedHints = menuResult.source?.context_hints ?? { language: "pt-br" };
      if (!bakedRationale) {
        throw new Error(
          `menu fixture ${persona.id}-menu.json não tem source.strategic_rationale`,
        );
      }
      console.log(
        `  ✓ Baked rationale (${bakedRationale.length} chars): ${bakedRationale.slice(0, 100)}...`,
      );

      // Salva pra selectedContent + markdown
      sharedCtx.contentPool = menuResult.items;
      sharedCtx.bakedRationale = bakedRationale;

      // ─── Variant B: Fresh (1 Qwen3 call no planejador prompt) ───────
      console.log("  [setup] Rationale Fresh via Qwen3...");
      const planejadorPrompt = buildSystemPrompt({
        sessionId: "poc",
        persona,
        state: {
          sessionId: "poc",
          trustLevel: 0.42,
          budgetRemaining: 90,
          turn: 1,
          eventLog: [],
        },
        incomingMessage: "oi",
      });
      console.log(`    planejador prompt: ${planejadorPrompt.length} chars`);
      const freshResp = await deps.callQwen3(
        planejadorPrompt,
        "Emita o JSON com rationale + hints.",
        400,
      );
      const freshParsed = deps.parseJsonLoose(freshResp.content);
      if (!freshParsed?.strategicRationale) {
        console.error(`[poc] Qwen3 returned unparseable rationale: ${freshResp.content}`);
        throw new Error("rationale fresh parse failed");
      }
      const freshRationale = freshParsed.strategicRationale;
      const freshHints = freshParsed.contextHints ?? { language: "pt-br" };
      console.log(
        `  ✓ Fresh rationale (${freshRationale.length} chars, ${freshResp.latency_ms}ms): ${freshRationale.slice(0, 100)}...`,
      );
      sharedCtx.freshRationale = freshRationale;
      sharedCtx.freshLatencyMs = freshResp.latency_ms;

      return [
        {
          name: "A_baked",
          label: "Baked (fixture)",
          contextHints: bakedHints,
          strategicRationale: bakedRationale,
          contentPool: menuResult.items,
          llmCallsBefore: 0,
          summaryForMarkdown: `> ${bakedRationale}\n\n_${bakedRationale.length} chars — fixture (instant read)_`,
        },
        {
          name: "B_fresh",
          label: "Fresh (Qwen3)",
          contextHints: freshHints,
          strategicRationale: freshRationale,
          contentPool: menuResult.items,
          llmCallsBefore: 1,
          setupLatencyMs: freshResp.latency_ms,
          setupTokensIn: freshResp.tokens_in,
          setupTokensOut: freshResp.tokens_out,
          summaryForMarkdown: `> ${freshRationale}\n\n_${freshRationale.length} chars — Qwen3 ${freshResp.latency_ms}ms (in=${freshResp.tokens_in}, out=${freshResp.tokens_out})_`,
        },
      ];
    },

    selectedContent({ variants, rankPool, selectFromPool }) {
      const ranked = rankPool(variants[0].contentPool);
      const fakeState = {
        sessionId: "poc",
        trustLevel: 0.42,
        budgetRemaining: 90,
        turn: 1,
      };
      const { selected } = selectFromPool(ranked, fakeState);
      return selected;
    },

    handoffSections: {
      question: `"O rationale **Baked** (texto static no \`action-menu.json\`, consumido pelo skip path do S-T-10-08) produz drota output **qualitativamente equivalente** ao rationale **Fresh** (gerado per-turn via LLM)?"

Se sim, justifica o skip (motor#115) sem comprometer pedagogia.`,
      additionalMetrics: (variants) => ({
        "Rationale source": variants
          .map((v) =>
            v.name === "A_baked"
              ? "fixture (instant read)"
              : `Qwen3 ${v.setupLatencyMs}ms`,
          )
          .join(" | "),
        "Rationale chars": [
          sharedCtx.bakedRationale.length,
          sharedCtx.freshRationale.length,
        ].join(" | "),
      }),
      verdictOptions: ["GO", "TUNE", "NO-GO"],
    },
  });
}

main().catch((err) => {
  console.error("[poc] FATAL:", err);
  process.exit(1);
});
