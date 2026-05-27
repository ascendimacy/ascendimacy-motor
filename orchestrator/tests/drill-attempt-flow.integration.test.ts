/**
 * Drill attempt flow integration — verifica que runTurn:
 *  (1) carrega bank via MCP + injeta `drill_proposal` em contextHints
 *  (2) loga `drill_emitted` post-turn quando selectedContent é drill_vocab
 *  (3) ao turn seguinte, detecta pending drill, matcheia resposta do user
 *      e chama drill_record_attempt + loga drill_attempt_recorded
 *  (4) `drill_item_mastered` é logado quando masteryReached=true
 *
 * Persona usada: `ryo-kid` (fixtures/ryo-kid.yaml) com drill_bank_ids declarado.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTurn } from "../src/orchestrator.js";
import type { McpClients } from "../src/mcp-clients.js";
import type { SessionState, EventEntry } from "@ascendimacy/shared";

let tracesDir: string;

beforeEach(() => {
  tracesDir = mkdtempSync(join(tmpdir(), "drill-flow-traces-"));
});

afterEach(() => {
  rmSync(tracesDir, { recursive: true, force: true });
});

interface RecordedCall {
  client: "planejador" | "motorDrota" | "motorExecucao";
  name: string;
  args: Record<string, unknown>;
}

const SAMPLE_DRILL_ITEM = {
  id: "jpv-001",
  bank_id: "ja-pt-vocab-n5",
  type: "vocab",
  axis: "language.jp_pt",
  difficulty: 1,
  payload: { prompt: "りんご", answer: "maçã", accept_variants: ["maca"] },
};

const SAMPLE_DRILL_VOCAB_ITEM = {
  id: "drill:jpv-001",
  type: "drill_vocab",
  domain: "drill.ja-pt-vocab-n5",
  casel_target: [],
  age_range: [6, 12],
  surprise: 3,
  verified: true,
  base_score: 60,
  sacrifice_amount: 2,
  drill_item_id: "jpv-001",
  bank_id: "ja-pt-vocab-n5",
  prompt: "りんご",
  answer: "maçã",
  source_language: "jp",
};

function buildMockClients(
  initialState: SessionState,
  opts: {
    selectedItem?: Record<string, unknown>;
    materialization?: string;
    masteryReached?: boolean;
    onCall: (call: RecordedCall) => void;
  },
): McpClients {
  const state: SessionState = JSON.parse(JSON.stringify(initialState));
  const planejador = {
    callTool: async (params: { name: string; arguments: Record<string, unknown> }) => {
      opts.onCall({ client: "planejador", name: params.name, args: params.arguments });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            strategicRationale: "mock",
            contentPool: opts.selectedItem
              ? [{ item: opts.selectedItem, score: 70, reasons: ["drill"] }]
              : [],
            contextHints: params.arguments["contextHints"] ?? {},
            is_critical: false,
          }),
        }],
      };
    },
  };
  const motorDrota = {
    callTool: async (params: { name: string; arguments: Record<string, unknown> }) => {
      opts.onCall({ client: "motorDrota", name: params.name, args: params.arguments });
      if (params.name === "extract_signals") {
        return {
          content: [{ type: "text", text: JSON.stringify({ signals: [] }) }],
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            selectedContent: opts.selectedItem
              ? { item: opts.selectedItem, score: 70, reasons: ["drill"] }
              : { item: { id: "x", type: "curiosity_hook" }, score: 1, reasons: [] },
            selectionRationale: "drill_window_proposal (B2)",
            linguisticMaterialization: opts.materialization ?? "Como se diz **りんご** em português?",
          }),
        }],
      };
    },
  };
  const motorExecucao = {
    callTool: async (params: { name: string; arguments: Record<string, unknown> }) => {
      opts.onCall({ client: "motorExecucao", name: params.name, args: params.arguments });
      if (params.name === "get_state") {
        return { content: [{ type: "text", text: JSON.stringify(state) }] };
      }
      if (params.name === "drill_load_bank") {
        return {
          content: [{ type: "text", text: JSON.stringify({
            bank: { bank_id: "ja-pt-vocab-n5", title: "t", curator: "jun" },
            items: [SAMPLE_DRILL_ITEM],
          }) }],
        };
      }
      if (params.name === "drill_list_due") {
        return { content: [{ type: "text", text: JSON.stringify({ states: [] }) }] };
      }
      if (params.name === "drill_record_attempt") {
        return {
          content: [{ type: "text", text: JSON.stringify({
            state: {
              persona_id: "ryo-kid",
              item_id: "jpv-001",
              presented_count: 1,
              correct_count: 1,
              last_seen_at: "2026-05-27T12:00:00.000Z",
              next_due_at: "2026-05-28T12:00:00.000Z",
              current_interval_days: 1,
              current_easiness: 2.6,
              mastery_reached_at: opts.masteryReached ? "2026-05-27T12:00:00.000Z" : null,
              last_5_attempts: ["correct"],
            },
            masteryReached: !!opts.masteryReached,
          }) }],
        };
      }
      if (params.name === "log_event") {
        const ev: EventEntry = {
          timestamp: new Date().toISOString(),
          type: String(params.arguments["type"]),
          data: (params.arguments["data"] ?? {}) as Record<string, unknown>,
        };
        state.eventLog = [...(state.eventLog ?? []), ev];
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, event: ev }) }] };
      }
      if (params.name === "execute_playbook") {
        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            newState: { ...state, turn: state.turn + 1 },
            eventLogged: { timestamp: new Date().toISOString(), type: "playbook_executed", data: {} },
          }) }],
        };
      }
      if (params.name === "detect_achievement") {
        return { content: [{ type: "text", text: JSON.stringify({}) }] };
      }
      if (params.name === "emit_card_for_signal") {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, skipped: true }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({}) }] };
    },
  };
  return {
    planejador: planejador as never,
    motorDrota: motorDrota as never,
    motorExecucao: motorExecucao as never,
  };
}

describe("runTurn — drill flow integration", () => {
  it("turn 1: carrega bank + propõe drill + loga drill_emitted post-turn", async () => {
    const calls: RecordedCall[] = [];
    const clients = buildMockClients(
      {
        sessionId: "s-drill-1",
        trustLevel: 0.5,
        budgetRemaining: 80,
        eventLog: [],
        turn: 0,
      },
      {
        selectedItem: SAMPLE_DRILL_VOCAB_ITEM,
        materialization: "Como se diz **りんご** em português?",
        onCall: (c) => calls.push(c),
      },
    );

    await runTurn(clients, "s-drill-1", "ryo-kid", "oi", tracesDir);

    // drill_load_bank chamado pra ja-pt-vocab-n5 (declarado no perfil).
    const bankCall = calls.find(
      (c) => c.client === "motorExecucao" && c.name === "drill_load_bank",
    );
    expect(bankCall).toBeDefined();
    expect(bankCall!.args["bankId"]).toBe("ja-pt-vocab-n5");

    // drill_list_due chamado pra a persona.
    const dueCall = calls.find(
      (c) => c.client === "motorExecucao" && c.name === "drill_list_due",
    );
    expect(dueCall).toBeDefined();
    expect(dueCall!.args["personaId"]).toBe("ryo-kid");

    // plan_turn recebeu drill_proposal serializado em contextHints.
    const planCall = calls.find((c) => c.client === "planejador" && c.name === "plan_turn");
    expect(planCall).toBeDefined();
    const hints = planCall!.args["contextHints"] as Record<string, unknown>;
    expect(hints).toBeDefined();
    const proposal = hints["drill_proposal"] as { hook: string; item: { id: string } };
    expect(proposal).toBeDefined();
    expect(proposal.hook).toBe("drill_window_proposal");
    expect(proposal.item.id).toBe("jpv-001");

    // Post-turn: drill_emitted event logado.
    const emittedLog = calls.find(
      (c) =>
        c.client === "motorExecucao" &&
        c.name === "log_event" &&
        (c.args["type"] as string) === "drill_emitted",
    );
    expect(emittedLog).toBeDefined();
    const emittedData = emittedLog!.args["data"] as Record<string, unknown>;
    expect(emittedData["drill_item_id"]).toBe("jpv-001");
    expect(emittedData["bank_id"]).toBe("ja-pt-vocab-n5");
  });

  it("turn N+1: detecta pending drill_emitted, matcheia resposta + grava attempt", async () => {
    const calls: RecordedCall[] = [];
    const justNow = new Date(Date.now() - 1500).toISOString(); // <5s latency
    const stateWithPending: SessionState = {
      sessionId: "s-drill-2",
      trustLevel: 0.6,
      budgetRemaining: 78,
      turn: 2,
      eventLog: [
        {
          timestamp: justNow,
          type: "drill_emitted",
          data: { drill_item_id: "jpv-001", bank_id: "ja-pt-vocab-n5", turn_number: 1 },
        },
      ],
    };
    const clients = buildMockClients(stateWithPending, {
      selectedItem: {
        id: "x",
        type: "curiosity_hook",
        domain: "generic",
        casel_target: [],
        age_range: [0, 99],
        surprise: 1,
        verified: true,
        base_score: 1,
      },
      materialization: "Boa! Vamos pra próxima.",
      onCall: (c) => calls.push(c),
    });

    // "maçã" = match exato pro item jpv-001.
    await runTurn(clients, "s-drill-2", "ryo-kid", "maçã", tracesDir);

    const recordCall = calls.find(
      (c) => c.client === "motorExecucao" && c.name === "drill_record_attempt",
    );
    expect(recordCall).toBeDefined();
    expect(recordCall!.args["itemId"]).toBe("jpv-001");
    expect(recordCall!.args["response"]).toBe("correct");
    expect(recordCall!.args["personaId"]).toBe("ryo-kid");

    const attemptLog = calls.find(
      (c) =>
        c.client === "motorExecucao" &&
        c.name === "log_event" &&
        (c.args["type"] as string) === "drill_attempt_recorded",
    );
    expect(attemptLog).toBeDefined();
    const data = attemptLog!.args["data"] as Record<string, unknown>;
    expect(data["drill_item_id"]).toBe("jpv-001");
    expect(data["correct"]).toBe(true);
    expect(data["mastery_reached"]).toBe(false);
  });

  it("loga drill_item_mastered quando masteryReached=true", async () => {
    const calls: RecordedCall[] = [];
    const justNow = new Date(Date.now() - 1500).toISOString();
    const stateWithPending: SessionState = {
      sessionId: "s-drill-3",
      trustLevel: 0.6,
      budgetRemaining: 78,
      turn: 5,
      eventLog: [
        {
          timestamp: justNow,
          type: "drill_emitted",
          data: { drill_item_id: "jpv-001", bank_id: "ja-pt-vocab-n5", turn_number: 4 },
        },
      ],
    };
    const clients = buildMockClients(stateWithPending, {
      masteryReached: true,
      onCall: (c) => calls.push(c),
    });

    await runTurn(clients, "s-drill-3", "ryo-kid", "maçã", tracesDir);

    const masteredLog = calls.find(
      (c) =>
        c.client === "motorExecucao" &&
        c.name === "log_event" &&
        (c.args["type"] as string) === "drill_item_mastered",
    );
    expect(masteredLog).toBeDefined();
    const data = masteredLog!.args["data"] as Record<string, unknown>;
    expect(data["drill_item_id"]).toBe("jpv-001");
    expect(data["bank_id"]).toBe("ja-pt-vocab-n5");
  });

  it("resposta incorreta → response=incorrect, sem mastered", async () => {
    const calls: RecordedCall[] = [];
    const justNow = new Date(Date.now() - 1500).toISOString();
    const stateWithPending: SessionState = {
      sessionId: "s-drill-4",
      trustLevel: 0.5,
      budgetRemaining: 80,
      turn: 1,
      eventLog: [
        {
          timestamp: justNow,
          type: "drill_emitted",
          data: { drill_item_id: "jpv-001", bank_id: "ja-pt-vocab-n5", turn_number: 0 },
        },
      ],
    };
    const clients = buildMockClients(stateWithPending, {
      onCall: (c) => calls.push(c),
    });

    await runTurn(clients, "s-drill-4", "ryo-kid", "banana", tracesDir);

    const recordCall = calls.find(
      (c) => c.client === "motorExecucao" && c.name === "drill_record_attempt",
    );
    expect(recordCall).toBeDefined();
    expect(recordCall!.args["response"]).toBe("incorrect");
  });
});
