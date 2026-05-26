/**
 * Tests journey_state pipeline: ledger entries → readOrComputeJourneyState
 * → endpoints REST + override parental.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import {
  readOrComputeJourneyState,
  setParentalOverride,
  clearParentalOverride,
} from "../src/journey-state-repo.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient, type MockDaemonClient } from "../src/daemon-client.js";
import type { Database as DatabaseType } from "better-sqlite3";

let db: DatabaseType;
let daemon: MockDaemonClient;
let server: BffServer;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
});

afterEach(async () => {
  await server.close();
});

function seedDiscovery(
  subjectId: string,
  type: "interest" | "value" | "need" | "discovery",
  family: string | null,
  i: number,
): void {
  const payload: Record<string, unknown> = { kind: type, label: `entry-${i}` };
  if (family) payload["family"] = family;
  db.prepare(
    `INSERT INTO subject_knowledge (
      id, subject_id, type, source, confidence, confirmed_at,
      alignment, payload_json, turn_ref, session_id, created_at
    ) VALUES (?, ?, ?, 'self_declared', 0.8, ?, 'unknown', ?, ?, ?, ?)`,
  ).run(
    `sk-${i}`,
    subjectId,
    type,
    `s1__t${i}`,
    JSON.stringify(payload),
    `s1__t${i}`,
    "s1",
    new Date(2026, 4, 25, 10, i).toISOString(),
  );
}

describe("readOrComputeJourneyState — auto-init", () => {
  it("sujeito novo retorna discovery_only com counts zerados", () => {
    const s = readOrComputeJourneyState(db, "kei");
    expect(s.stage).toBe("discovery_only");
    expect(s.discoveries_count).toBe(0);
    expect(s.families_covered).toEqual([]);
  });

  it("conta discoveries do ledger", () => {
    for (let i = 0; i < 5; i++) seedDiscovery("ryo", "interest", "carater", i);
    const s = readOrComputeJourneyState(db, "ryo");
    expect(s.discoveries_count).toBe(5);
    expect(s.families_covered).toEqual(["carater"]);
  });
});

describe("auto-transição discovery_only → mapping_ready", () => {
  it("não transiciona com 5 discoveries em 1 família", () => {
    for (let i = 0; i < 5; i++) seedDiscovery("ryo", "interest", "carater", i);
    const s = readOrComputeJourneyState(db, "ryo");
    expect(s.stage).toBe("discovery_only");
  });

  it("não transiciona com 10 discoveries mas 2 famílias", () => {
    for (let i = 0; i < 5; i++) seedDiscovery("ryo", "interest", "carater", i);
    for (let i = 5; i < 10; i++) seedDiscovery("ryo", "value", "disposicao", i);
    const s = readOrComputeJourneyState(db, "ryo");
    expect(s.stage).toBe("discovery_only");
  });

  it("transiciona com 10 discoveries em 3 famílias", () => {
    for (let i = 0; i < 4; i++) seedDiscovery("ryo", "interest", "carater", i);
    for (let i = 4; i < 7; i++) seedDiscovery("ryo", "value", "disposicao", i);
    for (let i = 7; i < 10; i++) seedDiscovery("ryo", "discovery", "cognicao_si", i);
    const s = readOrComputeJourneyState(db, "ryo");
    expect(s.stage).toBe("mapping_ready");
    expect(s.discoveries_count).toBe(10);
    expect(s.families_covered).toEqual(["carater", "cognicao_si", "disposicao"]);
  });

  it("aplica imediatamente: chamada idempotente, fica em mapping_ready", () => {
    for (let i = 0; i < 4; i++) seedDiscovery("ryo", "interest", "carater", i);
    for (let i = 4; i < 8; i++) seedDiscovery("ryo", "value", "disposicao", i);
    for (let i = 8; i < 12; i++) seedDiscovery("ryo", "need", "cognicao_si", i);
    const s1 = readOrComputeJourneyState(db, "ryo");
    expect(s1.stage).toBe("mapping_ready");
    // 2ª chamada não regride
    const s2 = readOrComputeJourneyState(db, "ryo");
    expect(s2.stage).toBe("mapping_ready");
    expect(s2.discoveries_count).toBe(12);
  });
});

describe("override parental", () => {
  it("setParentalOverride força stage", () => {
    const s = setParentalOverride(db, "ryo", "applied_double_helix", "pais ratificaram");
    expect(s.stage).toBe("applied_double_helix");
    expect(s.override_by_parent?.forced_stage).toBe("applied_double_helix");
    expect(s.override_by_parent?.reason).toBe("pais ratificaram");
  });

  it("override 'discovery_only' impede auto-transição mesmo com threshold OK", () => {
    for (let i = 0; i < 4; i++) seedDiscovery("ryo", "interest", "carater", i);
    for (let i = 4; i < 8; i++) seedDiscovery("ryo", "value", "disposicao", i);
    for (let i = 8; i < 12; i++) seedDiscovery("ryo", "need", "cognicao_si", i);
    setParentalOverride(db, "ryo", "discovery_only", "filho pediu mais descoberta");
    const s = readOrComputeJourneyState(db, "ryo");
    expect(s.stage).toBe("discovery_only");
  });

  it("clearParentalOverride restaura auto-flow", () => {
    setParentalOverride(db, "ryo", "discovery_only", "test");
    for (let i = 0; i < 4; i++) seedDiscovery("ryo", "interest", "carater", i);
    for (let i = 4; i < 8; i++) seedDiscovery("ryo", "value", "disposicao", i);
    for (let i = 8; i < 12; i++) seedDiscovery("ryo", "need", "cognicao_si", i);

    const beforeClear = readOrComputeJourneyState(db, "ryo");
    expect(beforeClear.stage).toBe("discovery_only");

    const afterClear = clearParentalOverride(db, "ryo");
    expect(afterClear.stage).toBe("mapping_ready");
    expect(afterClear.override_by_parent).toBeUndefined();
  });
});

describe("endpoints REST /subjects/:id/journey-state", () => {
  const inject = async (method: "GET" | "POST" | "DELETE", url: string, body?: unknown) => {
    const res = await server.fastify.inject({
      method,
      url,
      ...(body !== undefined ? { payload: body } : {}),
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : null,
    };
  };

  it("GET retorna state inicial pra sujeito novo", async () => {
    const r = await inject("GET", "/subjects/ryo/journey-state");
    expect(r.status).toBe(200);
    expect(r.body.state.stage).toBe("discovery_only");
  });

  it("POST override aplica e retorna novo state", async () => {
    const r = await inject("POST", "/subjects/ryo/journey-state/override", {
      stage: "applied_double_helix",
      reason: "ratificado",
    });
    expect(r.status).toBe(200);
    expect(r.body.state.stage).toBe("applied_double_helix");
    expect(r.body.state.override_by_parent.reason).toBe("ratificado");
  });

  it("POST override rejeita stage inválido", async () => {
    const r = await inject("POST", "/subjects/ryo/journey-state/override", {
      stage: "garbage",
      reason: "x",
    });
    expect(r.status).toBe(400);
  });

  it("POST override rejeita reason vazio", async () => {
    const r = await inject("POST", "/subjects/ryo/journey-state/override", {
      stage: "mapping_ready",
      reason: "",
    });
    expect(r.status).toBe(400);
  });

  it("DELETE override remove e re-avalia", async () => {
    await inject("POST", "/subjects/ryo/journey-state/override", {
      stage: "discovery_only",
      reason: "hold",
    });
    const after = await inject("DELETE", "/subjects/ryo/journey-state/override");
    expect(after.status).toBe(200);
    expect(after.body.state.override_by_parent).toBeUndefined();
  });
});
