/**
 * Unit tests — content-usage-repo (ops#1067).
 *
 * Cobre UPSERT idempotente + leitura individual + leitura batch per-persona.
 * In-memory SQLite pra isolamento.
 */

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";

import {
  CONTENT_USAGE_DDL,
  countContentUsage,
  getAllContentUsageByPersona,
  getContentUsage,
  recordContentUsage,
} from "../src/content-usage-repo.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CONTENT_USAGE_DDL);
});

describe("recordContentUsage — UPSERT idempotent", () => {
  it("primeira chamada: cria row com times_used=1", () => {
    const row = recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "ling_inuit_snow",
      nowIso: "2026-05-14T10:00:00.000Z",
    });

    expect(row.persona_id).toBe("ryo-ochiai");
    expect(row.content_id).toBe("ling_inuit_snow");
    expect(row.times_used).toBe(1);
    expect(row.last_used_at).toBe("2026-05-14T10:00:00.000Z");
  });

  it("chamadas múltiplas: incrementa times_used + atualiza last_used_at", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "ling_inuit_snow",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "ling_inuit_snow",
      nowIso: "2026-05-14T10:15:00.000Z",
    });
    const row = recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "ling_inuit_snow",
      nowIso: "2026-05-14T10:30:00.000Z",
    });

    expect(row.times_used).toBe(3);
    expect(row.last_used_at).toBe("2026-05-14T10:30:00.000Z");
  });

  it("personas separadas: usage independente", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "ling_inuit_snow",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "kei-ochiai",
      contentId: "ling_inuit_snow",
      nowIso: "2026-05-14T10:00:00.000Z",
    });

    expect(getContentUsage(db, { personaId: "ryo-ochiai", contentId: "ling_inuit_snow" })?.times_used).toBe(1);
    expect(getContentUsage(db, { personaId: "kei-ochiai", contentId: "ling_inuit_snow" })?.times_used).toBe(1);
    expect(countContentUsage(db)).toBe(2);
  });

  it("items separados, mesma persona: independente", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-a",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-b",
      nowIso: "2026-05-14T10:00:00.000Z",
    });

    expect(getContentUsage(db, { personaId: "ryo-ochiai", contentId: "item-a" })?.times_used).toBe(1);
    expect(getContentUsage(db, { personaId: "ryo-ochiai", contentId: "item-b" })?.times_used).toBe(1);
  });
});

describe("getContentUsage", () => {
  it("retorna null pra row não existente", () => {
    expect(
      getContentUsage(db, { personaId: "ryo-ochiai", contentId: "never-used" }),
    ).toBeNull();
  });

  it("retorna row após recordContentUsage", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-x",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    const row = getContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-x",
    });
    expect(row).not.toBeNull();
    expect(row?.times_used).toBe(1);
  });
});

describe("getAllContentUsageByPersona", () => {
  it("retorna Map vazio pra persona sem usage", () => {
    const map = getAllContentUsageByPersona(db, "ryo-ochiai");
    expect(map.size).toBe(0);
  });

  it("retorna Map com todos items da persona", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-a",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-b",
      nowIso: "2026-05-14T11:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "kei-ochiai", // outra persona — não deve aparecer
      contentId: "item-c",
      nowIso: "2026-05-14T12:00:00.000Z",
    });

    const map = getAllContentUsageByPersona(db, "ryo-ochiai");
    expect(map.size).toBe(2);
    expect(map.get("item-a")?.times_used).toBe(1);
    expect(map.get("item-b")?.times_used).toBe(1);
    expect(map.has("item-c")).toBe(false);
  });
});

describe("countContentUsage — debug helper", () => {
  it("retorna 0 em db vazio", () => {
    expect(countContentUsage(db)).toBe(0);
  });

  it("conta rows após inserts (per persona × content)", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "a",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "b",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    // UPSERT na mesma row não cria nova
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "a",
      nowIso: "2026-05-14T11:00:00.000Z",
    });

    expect(countContentUsage(db)).toBe(2);
  });
});
