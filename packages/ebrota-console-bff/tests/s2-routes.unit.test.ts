/**
 * S2 routes — unit tests com SQLite :memory: + playbooks dir temporário.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Cobre:
 *  - active-playbook: default stub / wizard complete / manual override / YAML resolvido
 *  - journey-stage: default discovery_only / mapping_ready / applied_double_helix
 *  - drota-config: stub sem idade / kids / eprumo / drota-mestre / split env toggle
 *  - 404 implícito em rotas inexistentes (Fastify default)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../src/db.js";
import { initParentalOnboardingSchema, saveDraft, markComplete } from "../src/parental-onboarding-store.js";
import s2Routes from "../src/routes/s2-routes.js";

let app: FastifyInstance;
let db: DatabaseType;
let playbooksDir: string;

beforeEach(async () => {
  db = initDb({ dbPath: ":memory:" });
  initParentalOnboardingSchema(db);
  playbooksDir = mkdtempSync(join(tmpdir(), "s2-playbooks-"));
  app = Fastify({ logger: false });
  await app.register(s2Routes, {
    db,
    playbooksDir,
    env: {},
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(playbooksDir, { recursive: true, force: true });
});

const inject = async (url: string) => {
  const res = await app.inject({ method: "GET", url });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null,
  };
};

function writePlaybook(filename: string, body: string): void {
  writeFileSync(join(playbooksDir, filename), body, "utf8");
}

function seedWizard(opts: {
  acquirerId: string;
  children: Array<{ id: string; name: string; age?: number; playbook_id?: string }>;
  complete?: boolean;
}): void {
  const state = {
    family: {
      acquirer: { id: opts.acquirerId, name: opts.acquirerId },
      children: opts.children,
    },
  };
  if (opts.complete) {
    markComplete(db, state);
  } else {
    saveDraft(db, state);
  }
}

describe("GET /personas/:id/active-playbook", () => {
  it("retorna dev stub quando persona não está em wizard e YAML default ausente", async () => {
    const res = await inject("/personas/ryo/active-playbook");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      personaId: "ryo",
      playbookId: "kids.brota.v1",
      playbookName: "unknown_playbook",
      version: "0.0.0",
      appliedReason: "default_at_persona_create",
      developmentStub: true,
    });
  });

  it("retorna playbook real quando YAML existe (name+version)", async () => {
    writePlaybook(
      "kids.brota.v1.playbook.yaml",
      `name: "Brota — Kids tutor v1"\nversion: "1.0.0"\n`,
    );
    const res = await inject("/personas/ryo/active-playbook");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      playbookId: "kids.brota.v1",
      playbookName: "Brota — Kids tutor v1",
      version: "1.0.0",
      developmentStub: false,
    });
  });

  it("appliedReason='wizard_complete' quando onboarding marcado complete", async () => {
    writePlaybook("kids.brota.v1.yaml", `name: "Brota Kids"\nversion: "1.0.0"\n`);
    seedWizard({
      acquirerId: "yuji",
      children: [{ id: "ryo", name: "Ryo", age: 9 }],
      complete: true,
    });
    const res = await inject("/personas/ryo/active-playbook");
    expect(res.body).toMatchObject({
      personaId: "ryo",
      appliedReason: "wizard_complete",
      developmentStub: false,
    });
    expect(typeof (res.body as { appliedAt: string }).appliedAt).toBe("string");
  });

  it("appliedReason='manual_override' quando child.playbook_id explícito", async () => {
    writePlaybook("kids.custom.yaml", `name: "Custom"\nversion: "2.0.0"\n`);
    seedWizard({
      acquirerId: "yuji",
      children: [{ id: "ryo", name: "Ryo", age: 9, playbook_id: "kids.custom" }],
      complete: true,
    });
    const res = await inject("/personas/ryo/active-playbook");
    expect(res.body).toMatchObject({
      playbookId: "kids.custom",
      playbookName: "Custom",
      version: "2.0.0",
      appliedReason: "manual_override",
      developmentStub: false,
    });
  });
});

describe("GET /personas/:id/journey-stage", () => {
  it("default state = discovery_only + blockedBy=insufficient_discoveries", async () => {
    const res = await inject("/personas/ryo/journey-stage");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      personaId: "ryo",
      stage: "discovery_only",
      turnsInStage: 0,
      nextStageHint: "mapping_ready",
      blockedBy: "insufficient_discoveries",
    });
  });

  it("conta turnsInStage como subject_knowledge >= stage_entered_at", async () => {
    // Força um row em journey_state com stage_entered_at fixo no passado.
    const past = "2026-01-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO journey_state
       (subject_id, stage, stage_entered_at, discoveries_count, families_covered, last_updated_at)
       VALUES ('ryo', 'discovery_only', ?, 0, '[]', ?)`,
    ).run(past, past);

    // Insere 3 entries depois do stage_entered_at e 1 antes (não conta).
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO subject_knowledge
         (id, subject_id, type, source, confidence, alignment, payload_json,
          turn_ref, session_id, created_at)
         VALUES (?, 'ryo', 'interest', 'self_declared', 1.0, 'unknown', '{}',
                 't1', 'sess-A', ?)`,
      ).run(`sk-after-${i}`, "2026-02-01T00:00:00.000Z");
    }
    db.prepare(
      `INSERT INTO subject_knowledge
       (id, subject_id, type, source, confidence, alignment, payload_json,
        turn_ref, session_id, created_at)
       VALUES ('sk-before', 'ryo', 'interest', 'self_declared', 1.0, 'unknown', '{}',
               't0', 'sess-A', '2025-12-01T00:00:00.000Z')`,
    ).run();

    const res = await inject("/personas/ryo/journey-stage");
    expect((res.body as { turnsInStage: number }).turnsInStage).toBe(3);
  });

  it("override forçando applied_double_helix → blockedBy=null + nextStageHint=null", async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO journey_state
       (subject_id, stage, stage_entered_at, discoveries_count, families_covered,
        override_by_parent, last_updated_at)
       VALUES ('ryo', 'applied_double_helix', ?, 0, '[]', ?, ?)`,
    ).run(
      now,
      JSON.stringify({
        forced_stage: "applied_double_helix",
        reason: "test",
        timestamp: now,
      }),
      now,
    );
    const res = await inject("/personas/ryo/journey-stage");
    expect(res.body).toMatchObject({
      stage: "applied_double_helix",
      nextStageHint: null,
      blockedBy: null,
    });
  });
});

describe("GET /personas/:id/drota-config", () => {
  it("dev stub quando idade desconhecida (persona não em wizard)", async () => {
    const res = await inject("/personas/ghost/drota-config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      personaId: "ghost",
      drotaProfile: "kids",
      registerDefault: "lúdico",
      developmentStub: true,
      splitDrotaEnabled: false,
      splitDrotaSource: "env",
    });
  });

  it("infere kids quando age ≤ 12", async () => {
    seedWizard({
      acquirerId: "yuji",
      children: [{ id: "ryo", name: "Ryo", age: 9 }],
    });
    const res = await inject("/personas/ryo/drota-config");
    expect(res.body).toMatchObject({
      drotaProfile: "kids",
      registerDefault: "lúdico",
      developmentStub: false,
    });
  });

  it("infere eprumo quando age ≥ 18", async () => {
    seedWizard({
      acquirerId: "yuji",
      children: [{ id: "adult", name: "Adult", age: 30 }],
    });
    const res = await inject("/personas/adult/drota-config");
    expect(res.body).toMatchObject({
      drotaProfile: "eprumo",
      registerDefault: "profissional",
      developmentStub: false,
    });
  });

  it("infere drota-mestre na faixa intermediária (13-17)", async () => {
    seedWizard({
      acquirerId: "yuji",
      children: [{ id: "teen", name: "Teen", age: 15 }],
    });
    const res = await inject("/personas/teen/drota-config");
    expect(res.body).toMatchObject({
      drotaProfile: "drota-mestre",
      registerDefault: "formal",
    });
  });

  it("splitDrotaEnabled=true quando env USE_SPLIT_DROTA='true'", async () => {
    // Re-bootstrap app com env injetado — o beforeEach default usa env={}.
    await app.close();
    app = Fastify({ logger: false });
    await app.register(s2Routes, {
      db,
      playbooksDir,
      env: { USE_SPLIT_DROTA: "true" },
    });
    await app.ready();

    const res = await inject("/personas/ryo/drota-config");
    expect(res.body).toMatchObject({
      splitDrotaEnabled: true,
      splitDrotaSource: "env",
    });
  });
});

describe("S2 routes — 404 fallthrough", () => {
  it("rotas não declaradas em /personas/:id retornam 404 Fastify default", async () => {
    const res = await inject("/personas/ryo/does-not-exist");
    expect(res.status).toBe(404);
  });
});
