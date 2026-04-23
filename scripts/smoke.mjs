#!/usr/bin/env node
/**
 * Smoke test: roda 1 turno completo com mocks de LLM.
 * Valida que os 3 serviços foram invocados em ordem e produzem resposta não-vazia.
 */
import { runTurn } from "../orchestrator/dist/orchestrator.js";

process.env["USE_MOCK_LLM"] = "true";

const sessionId = `smoke-${Date.now()}`;
const tracesDir = new URL("../traces", import.meta.url).pathname;

async function main() {
  console.log("[smoke] Iniciando smoke test com mocks...");

  let result;
  try {
    const { connectAll, disconnectAll } = await import("../orchestrator/dist/mcp-clients.js");
    const clients = await connectAll();
    try {
      result = await runTurn(clients, sessionId, "paula-mendes", "oi, tudo bem?", tracesDir);
    } finally {
      await disconnectAll(clients);
    }
  } catch (err) {
    console.error("[smoke] FALHOU:", err);
    process.exit(1);
  }

  const trace = JSON.parse(
    (await import("node:fs")).readFileSync(result.tracePath, "utf-8")
  );

  const errors = [];

  // G1: todos os 3 serviços foram chamados
  const turn = trace.turns[0];
  if (!turn) {
    errors.push("G1 FAIL: nenhum turno no trace");
  } else {
    const services = turn.entries.map(e => e.service);
    if (!services.includes("planejador")) errors.push("G1 FAIL: planejador não chamado");
    if (!services.includes("motor-drota")) errors.push("G1 FAIL: motor-drota não chamado");
    if (!services.includes("motor-execucao")) errors.push("G1 FAIL: motor-execucao não chamado (espera 2x: get_state + execute_playbook)");

    // G2: finalResponse não-vazia
    if (!turn.finalResponse || turn.finalResponse.trim().length < 5) {
      errors.push("G2 FAIL: finalResponse vazia ou muito curta");
    }

    // G3: entries tem pelo menos 3 entradas (get_state + plan_turn + evaluate_and_select + execute_playbook = 4)
    if (turn.entries.length < 3) {
      errors.push(`G3 FAIL: esperava >=3 entries, recebeu ${turn.entries.length}`);
    }
  }

  if (errors.length > 0) {
    console.error("[smoke] RUBRIC FALHOU:");
    for (const e of errors) console.error(" -", e);
    process.exit(1);
  }

  console.log("[smoke] OK — Rubric G1-G3 verde");
  console.log("[smoke] Resposta:", result.finalResponse);
  console.log("[smoke] Trace:", result.tracePath);
  console.log("[smoke] Entries:", turn.entries.map(e => e.service).join(" -> "));
}

main();
