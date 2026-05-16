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
  getRecentContentUsageRecord,
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

describe("getRecentContentUsageRecord — G-22 Gap 2 hydration (ops#1033)", () => {
  it("retorna {} para persona sem usage", () => {
    expect(getRecentContentUsageRecord(db, "ryo-ochiai", 14, "2026-05-14T10:00:00.000Z"))
      .toEqual({});
  });

  it("projeta {content_id: times_used} para usage dentro da janela", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-a",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-a",
      nowIso: "2026-05-14T11:00:00.000Z", // times_used=2
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-b",
      nowIso: "2026-05-14T11:00:00.000Z",
    });

    const record = getRecentContentUsageRecord(
      db,
      "ryo-ochiai",
      14,
      "2026-05-14T12:00:00.000Z",
    );
    expect(record).toEqual({ "item-a": 2, "item-b": 1 });
  });

  it("filtra rows fora da janela (14d default)", () => {
    // Usage muito antigo — 30 dias atrás
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "old-item",
      nowIso: "2026-04-14T10:00:00.000Z",
    });
    // Usage recente — 5 dias atrás
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "recent-item",
      nowIso: "2026-05-09T10:00:00.000Z",
    });

    const record = getRecentContentUsageRecord(
      db,
      "ryo-ochiai",
      14,
      "2026-05-14T10:00:00.000Z",
    );
    expect(record).toEqual({ "recent-item": 1 });
    expect(record).not.toHaveProperty("old-item");
  });

  it("janela customizada respeitada (e.g., 7 dias)", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "day-10-old",
      nowIso: "2026-05-04T10:00:00.000Z", // 10 dias atrás
    });
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "day-3-old",
      nowIso: "2026-05-11T10:00:00.000Z", // 3 dias atrás
    });

    const recent7 = getRecentContentUsageRecord(
      db,
      "ryo-ochiai",
      7,
      "2026-05-14T10:00:00.000Z",
    );
    expect(recent7).toEqual({ "day-3-old": 1 });

    const recent14 = getRecentContentUsageRecord(
      db,
      "ryo-ochiai",
      14,
      "2026-05-14T10:00:00.000Z",
    );
    expect(recent14).toEqual({ "day-10-old": 1, "day-3-old": 1 });
  });

  it("isola personas (cross-persona não vaza)", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-x",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(db, {
      personaId: "kei-ochiai",
      contentId: "item-y",
      nowIso: "2026-05-14T10:00:00.000Z",
    });

    expect(getRecentContentUsageRecord(db, "ryo-ochiai", 14, "2026-05-14T11:00:00.000Z"))
      .toEqual({ "item-x": 1 });
    expect(getRecentContentUsageRecord(db, "kei-ochiai", 14, "2026-05-14T11:00:00.000Z"))
      .toEqual({ "item-y": 1 });
  });

  it("retorna {} defensivo se nowIso malformado", () => {
    recordContentUsage(db, {
      personaId: "ryo-ochiai",
      contentId: "item-z",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    expect(getRecentContentUsageRecord(db, "ryo-ochiai", 14, "not-a-date"))
      .toEqual({});
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
