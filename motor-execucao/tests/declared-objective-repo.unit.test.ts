import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  DECLARED_OBJECTIVES_DDL,
  createObjective,
  markRevised,
  updateStatus,
  listActive,
  findDueForDriftCheck,
  getDeclaredObjective,
} from "../src/declared-objective-repo.js";
import type { DeclaredObjectiveDraft } from "@ascendimacy/shared";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(DECLARED_OBJECTIVES_DDL);
});

afterEach(() => {
  db.close();
});

function draft(overrides: Partial<DeclaredObjectiveDraft> = {}): DeclaredObjectiveDraft {
  return {
    persona_id: "ryo",
    declared_at: "2026-05-26T10:00:00.000Z",
    declared_in_session: "sess-1",
    target_date: "2026-06-30T23:59:59.000Z",
    statement: "Aprender frações até fim do mês",
    axis: "math:fractions",
    ...overrides,
  };
}

describe("declared-objective-repo CRUD", () => {
  it("createObjective insere com status='active' e id auto-gerado", () => {
    const obj = createObjective(db, draft());
    expect(obj.id).toBeTruthy();
    expect(obj.status).toBe("active");
    expect(obj.persona_id).toBe("ryo");
    expect(obj.statement).toBe("Aprender frações até fim do mês");
    expect(obj.target_date).toBe("2026-06-30T23:59:59.000Z");
    expect(obj.axis).toBe("math:fractions");
  });

  it("createObjective persiste axis opcional", () => {
    const a = createObjective(db, draft({ axis: undefined }));
    const b = createObjective(db, draft({ axis: "virtue:wisdom" }));
    const ra = getDeclaredObjective(db, a.id);
    const rb = getDeclaredObjective(db, b.id);
    expect(ra?.axis).toBeUndefined();
    expect(rb?.axis).toBe("virtue:wisdom");
  });

  it("createObjective persiste drift_check_due_at", () => {
    const obj = createObjective(
      db,
      draft({ drift_check_due_at: "2026-06-09T00:00:00.000Z" }),
    );
    const fetched = getDeclaredObjective(db, obj.id);
    expect(fetched?.drift_check_due_at).toBe("2026-06-09T00:00:00.000Z");
  });

  it("createObjective persiste evidence_event_ids array", () => {
    const obj = createObjective(
      db,
      draft({ evidence_event_ids: ["evt-1", "evt-2"] }),
    );
    const fetched = getDeclaredObjective(db, obj.id);
    expect(fetched?.evidence_event_ids).toEqual(["evt-1", "evt-2"]);
  });
});

describe("declared-objective-repo status transitions", () => {
  it("updateStatus cria nova versão linkada via parent_objective_id", () => {
    const orig = createObjective(db, draft());
    const flagged = updateStatus(db, orig.id, "drift_flagged");
    expect(flagged.id).not.toBe(orig.id);
    expect(flagged.status).toBe("drift_flagged");
    expect(flagged.parent_objective_id).toBe(orig.id);
    // Original ainda existe (append-only)
    expect(getDeclaredObjective(db, orig.id)?.status).toBe("active");
  });

  it("updateStatus merge evidence_event_ids existentes + novos", () => {
    const orig = createObjective(
      db,
      draft({ evidence_event_ids: ["evt-1"] }),
    );
    const achieved = updateStatus(db, orig.id, "achieved", ["evt-2", "evt-3"]);
    expect(achieved.evidence_event_ids).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("updateStatus throw em id inexistente", () => {
    expect(() => updateStatus(db, "nonexistent", "achieved")).toThrow();
  });

  it("markRevised cria row com newId, status='revised', parent=oldId", () => {
    const orig = createObjective(db, draft());
    const newId = "manually-assigned-new-id";
    const rev = markRevised(db, orig.id, newId);
    expect(rev.id).toBe(newId);
    expect(rev.status).toBe("revised");
    expect(rev.parent_objective_id).toBe(orig.id);
    expect(rev.statement).toBe(orig.statement);
  });

  it("markRevised throw em oldId inexistente", () => {
    expect(() => markRevised(db, "nonexistent", "x")).toThrow();
  });
});

describe("declared-objective-repo listActive", () => {
  it("retorna apenas rows active sem descendentes", () => {
    const a = createObjective(db, draft({ statement: "obj A" }));
    const b = createObjective(db, draft({ statement: "obj B" }));
    const _c = createObjective(db, draft({ statement: "obj C" }));
    // B fica superseded por achievement
    updateStatus(db, b.id, "achieved");
    // A fica superseded por drift_flagged
    updateStatus(db, a.id, "drift_flagged");

    const active = listActive(db, "ryo");
    expect(active.map((o) => o.statement)).toEqual(["obj C"]);
  });

  it("isola por persona", () => {
    createObjective(db, draft({ persona_id: "ryo", statement: "R1" }));
    createObjective(db, draft({ persona_id: "kei", statement: "K1" }));
    expect(listActive(db, "ryo").map((o) => o.statement)).toEqual(["R1"]);
    expect(listActive(db, "kei").map((o) => o.statement)).toEqual(["K1"]);
  });

  it("retorna lista vazia pra persona desconhecido", () => {
    expect(listActive(db, "unknown")).toEqual([]);
  });
});

describe("declared-objective-repo findDueForDriftCheck", () => {
  it("retorna apenas active com drift_check_due_at < now", () => {
    createObjective(
      db,
      draft({
        statement: "due",
        drift_check_due_at: "2026-05-20T00:00:00.000Z",
      }),
    );
    createObjective(
      db,
      draft({
        statement: "future",
        drift_check_due_at: "2026-12-31T00:00:00.000Z",
      }),
    );
    createObjective(db, draft({ statement: "no-due" })); // sem drift_check_due_at

    const due = findDueForDriftCheck(db, "2026-05-26T10:00:00.000Z");
    expect(due.map((o) => o.statement)).toEqual(["due"]);
  });

  it("ignora objectives superseded mesmo se due", () => {
    const obj = createObjective(
      db,
      draft({
        statement: "due-but-revised",
        drift_check_due_at: "2026-05-20T00:00:00.000Z",
      }),
    );
    updateStatus(db, obj.id, "drift_flagged");
    const due = findDueForDriftCheck(db, "2026-05-26T10:00:00.000Z");
    expect(due).toEqual([]);
  });
});
