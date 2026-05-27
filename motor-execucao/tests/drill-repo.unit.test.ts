import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  DRILL_STATES_DDL,
  getState,
  listAttempts,
  listDue,
  listMastered,
  loadBank,
  recordAttempt,
} from "../src/drill-repo.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(DRILL_STATES_DDL);
});

afterEach(() => {
  db.close();
});

const PERSONA = "ryo-ochiai";
const ITEM = "jpv-001";

describe("drill-repo CRUD", () => {
  it("getState retorna null quando não há estado", () => {
    expect(getState(db, PERSONA, ITEM)).toBeNull();
  });

  it("recordAttempt cria estado novo na 1ª tentativa", () => {
    const now = "2026-05-26T10:00:00.000Z";
    const state = recordAttempt(db, {
      personaId: PERSONA,
      itemId: ITEM,
      response: "correct",
      latencyMs: 1200,
      nowIso: now,
    });
    expect(state.presented_count).toBe(1);
    expect(state.correct_count).toBe(1);
    expect(state.current_interval_days).toBe(1);
    expect(state.current_easiness).toBeCloseTo(2.6, 5);
    expect(state.last_seen_at).toBe(now);
    expect(state.last_5_attempts).toEqual(["correct"]);

    const persisted = getState(db, PERSONA, ITEM);
    expect(persisted).not.toBeNull();
    expect(persisted!.presented_count).toBe(1);
  });

  it("recordAttempt incorrect reset interval + easiness cai", () => {
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: ITEM,
      response: "correct",
      nowIso: "2026-05-26T10:00:00.000Z",
    });
    const after = recordAttempt(db, {
      personaId: PERSONA,
      itemId: ITEM,
      response: "incorrect",
      nowIso: "2026-05-27T10:00:00.000Z",
    });
    expect(after.current_interval_days).toBe(1);
    expect(after.current_easiness).toBeCloseTo(2.4, 5); // 2.6 - 0.2
    expect(after.presented_count).toBe(2);
    expect(after.correct_count).toBe(1);
  });

  it("last_5_attempts mantém janela de 5", () => {
    const responses = [
      "correct",
      "incorrect",
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ] as const;
    for (const [i, r] of responses.entries()) {
      recordAttempt(db, {
        personaId: PERSONA,
        itemId: ITEM,
        response: r,
        nowIso: `2026-05-${20 + i}T10:00:00.000Z`,
      });
    }
    const final = getState(db, PERSONA, ITEM)!;
    expect(final.last_5_attempts).toHaveLength(5);
    // últimas 5 = correct, correct, correct, correct, correct
    expect(final.last_5_attempts).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
  });

  it("recordAttempt registra mastery_reached_at uma vez", () => {
    // Sequência: 5 correct com intervals progressivos > 7d.
    // Como cada correct multiplica intervalo, basta 4-5 corretos pra chegar lá.
    let now = new Date("2026-05-01T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      recordAttempt(db, {
        personaId: PERSONA,
        itemId: ITEM,
        response: "correct",
        nowIso: now.toISOString(),
      });
      now = new Date(now.getTime() + 30 * 86_400_000);
    }
    const state = getState(db, PERSONA, ITEM)!;
    expect(state.mastery_reached_at).not.toBeNull();
    expect(state.current_interval_days).toBeGreaterThanOrEqual(7);

    // Próxima attempt não deve resetar mastery timestamp.
    const masteryTs = state.mastery_reached_at;
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: ITEM,
      response: "correct",
      nowIso: now.toISOString(),
    });
    const after = getState(db, PERSONA, ITEM)!;
    expect(after.mastery_reached_at).toBe(masteryTs);
  });

  it("listDue retorna apenas items com next_due_at <= now", () => {
    // Item A: due imediatamente (incorrect = interval 1d)
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: "item-a",
      response: "incorrect",
      nowIso: "2026-05-01T10:00:00.000Z",
    });
    // Item B: muito no futuro (5 acertos seguidos → interval cresce)
    let ts = new Date("2026-05-01T10:00:00.000Z");
    for (let i = 0; i < 4; i++) {
      recordAttempt(db, {
        personaId: PERSONA,
        itemId: "item-b",
        response: "correct",
        nowIso: ts.toISOString(),
      });
      ts = new Date(ts.getTime() + 30 * 86_400_000);
    }

    const due = listDue(db, PERSONA, "2026-05-03T10:00:00.000Z");
    expect(due.map((s) => s.item_id)).toContain("item-a");
    expect(due.map((s) => s.item_id)).not.toContain("item-b");
  });

  it("listDue isola por persona", () => {
    recordAttempt(db, {
      personaId: "ryo",
      itemId: "x",
      response: "incorrect",
      nowIso: "2026-05-01T10:00:00.000Z",
    });
    recordAttempt(db, {
      personaId: "kei",
      itemId: "y",
      response: "incorrect",
      nowIso: "2026-05-01T10:00:00.000Z",
    });
    const ryoDue = listDue(db, "ryo", "2026-05-10T10:00:00.000Z");
    expect(ryoDue).toHaveLength(1);
    expect(ryoDue[0]!.item_id).toBe("x");
  });

  it("listMastered retorna apenas items com mastery_reached_at", () => {
    // Item masterizado
    let ts = new Date("2026-05-01T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      recordAttempt(db, {
        personaId: PERSONA,
        itemId: "item-mastered",
        response: "correct",
        nowIso: ts.toISOString(),
      });
      ts = new Date(ts.getTime() + 30 * 86_400_000);
    }
    // Item ainda não masterizado
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: "item-fresh",
      response: "correct",
      nowIso: "2026-05-01T10:00:00.000Z",
    });

    const mastered = listMastered(db, PERSONA);
    expect(mastered.map((s) => s.item_id)).toEqual(["item-mastered"]);
  });

  it("listAttempts retorna log na ordem (audit)", () => {
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: ITEM,
      response: "incorrect",
      latencyMs: 8000,
      nowIso: "2026-05-01T10:00:00.000Z",
    });
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: ITEM,
      response: "correct",
      latencyMs: 1500,
      nowIso: "2026-05-02T10:00:00.000Z",
    });
    const log = listAttempts(db, PERSONA, ITEM);
    expect(log).toHaveLength(2);
    expect(log[0]!.response).toBe("incorrect");
    expect(log[0]!.latency_ms).toBe(8000);
    expect(log[1]!.response).toBe("correct");
  });

  it("listAttempts sem itemId retorna todos do persona", () => {
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: "a",
      response: "correct",
      nowIso: "2026-05-01T10:00:00.000Z",
    });
    recordAttempt(db, {
      personaId: PERSONA,
      itemId: "b",
      response: "incorrect",
      nowIso: "2026-05-02T10:00:00.000Z",
    });
    expect(listAttempts(db, PERSONA)).toHaveLength(2);
  });
});

describe("loadBank — ja-pt-vocab-n5", () => {
  const FIXTURE = resolve(
    process.cwd(),
    "../fixtures/banks/ja-pt-vocab-n5.yaml",
  );
  // motor-execucao roda testes com CWD = motor-execucao/, então sobe um nível.
  // Tentamos ambos pra robustez quando vitest é executado da raiz.
  const ALT_FIXTURE = resolve(
    process.cwd(),
    "fixtures/banks/ja-pt-vocab-n5.yaml",
  );

  function loadFixture() {
    try {
      return loadBank(FIXTURE);
    } catch {
      return loadBank(ALT_FIXTURE);
    }
  }

  it("carrega 50 items válidos com bank_id denormalizado", () => {
    const { bank, items } = loadFixture();
    expect(bank.bank_id).toBe("ja-pt-vocab-n5");
    expect(items).toHaveLength(50);
    for (const item of items) {
      expect(item.bank_id).toBe("ja-pt-vocab-n5");
      expect(item.axis).toBe("language.jp_pt");
      expect([1, 2]).toContain(item.difficulty);
      expect(item.payload.prompt.length).toBeGreaterThan(0);
      expect(item.payload.answer.length).toBeGreaterThan(0);
    }
  });

  it("ids são únicos no banco", () => {
    const { items } = loadFixture();
    const ids = new Set(items.map((it) => it.id));
    expect(ids.size).toBe(items.length);
  });
});
