import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initMc1Schema,
  scheduleMc1,
  nextPendingByPersona,
  listPending,
  getById,
  latestByPersona,
  markDelivered,
  cancelPendingByPersona,
} from "../src/mc1-repo.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initMc1Schema(db);
});

const PT_TEXT =
  "Olá. Sou o Brota. Teu pai mencionou que eu ia falar contigo.";

describe("mc1-repo — schedule + read", () => {
  it("scheduleMc1 persists row com status=pending", () => {
    const rec = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: PT_TEXT,
      targetWindowName: "post-school-jp",
      scheduledAt: "2026-05-27T10:00:00.000Z",
    });
    expect(rec.id).toBeGreaterThan(0);
    expect(rec.status).toBe("pending");
    expect(rec.deliveredAt).toBeNull();
    expect(rec.approvedText).toBe(PT_TEXT);
  });

  it("nextPendingByPersona retorna FIFO mais antigo", () => {
    const a = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "a",
      targetWindowName: "w",
      scheduledAt: "2026-05-27T10:00:00.000Z",
    });
    scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "b",
      targetWindowName: "w",
      scheduledAt: "2026-05-27T11:00:00.000Z",
    });
    const next = nextPendingByPersona(db, "ryo-ochiai");
    expect(next?.id).toBe(a.id);
    expect(next?.approvedText).toBe("a");
  });

  it("nextPendingByPersona retorna null se nenhum pending", () => {
    expect(nextPendingByPersona(db, "ryo-ochiai")).toBeNull();
  });

  it("listPending lista todas as pending ordenadas", () => {
    scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "a",
      targetWindowName: "w",
      scheduledAt: "2026-05-27T10:00:00.000Z",
    });
    scheduleMc1(db, {
      personaId: "kei-ochiai",
      approvedText: "b",
      targetWindowName: "w",
      scheduledAt: "2026-05-27T11:00:00.000Z",
    });
    const pending = listPending(db);
    expect(pending).toHaveLength(2);
    expect(pending[0]!.personaId).toBe("ryo-ochiai");
    expect(pending[1]!.personaId).toBe("kei-ochiai");
  });

  it("getById retorna o registro completo", () => {
    const rec = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: PT_TEXT,
      targetWindowName: "post-school-jp",
    });
    const fetched = getById(db, rec.id);
    expect(fetched?.personaId).toBe("ryo-ochiai");
    expect(fetched?.approvedText).toBe(PT_TEXT);
  });

  it("latestByPersona retorna o mais recente independente de status", () => {
    const a = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "a",
      targetWindowName: "w",
      scheduledAt: "2026-05-27T10:00:00.000Z",
    });
    cancelPendingByPersona(db, "ryo-ochiai");
    const b = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "b",
      targetWindowName: "w",
      scheduledAt: "2026-05-27T11:00:00.000Z",
    });
    const latest = latestByPersona(db, "ryo-ochiai");
    expect(latest?.id).toBe(b.id);
    expect(latest?.status).toBe("pending");
    expect(a.id).not.toBe(b.id);
  });
});

describe("mc1-repo — markDelivered", () => {
  it("transitions pending → delivered + grava timestamp", () => {
    const rec = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: PT_TEXT,
      targetWindowName: "post-school-jp",
    });
    const ok = markDelivered(db, rec.id, "2026-05-27T16:30:00.000Z");
    expect(ok).toBe(true);
    const fetched = getById(db, rec.id);
    expect(fetched?.status).toBe("delivered");
    expect(fetched?.deliveredAt).toBe("2026-05-27T16:30:00.000Z");
  });

  it("markDelivered em row já delivered → no-op (returns false)", () => {
    const rec = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: PT_TEXT,
      targetWindowName: "w",
    });
    markDelivered(db, rec.id);
    expect(markDelivered(db, rec.id)).toBe(false);
  });

  it("markDelivered em row cancelled → no-op", () => {
    const rec = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: PT_TEXT,
      targetWindowName: "w",
    });
    cancelPendingByPersona(db, "ryo-ochiai");
    expect(markDelivered(db, rec.id)).toBe(false);
  });
});

describe("mc1-repo — cancelPendingByPersona", () => {
  it("cancela todas as pending da persona", () => {
    scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "a",
      targetWindowName: "w",
    });
    scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "b",
      targetWindowName: "w",
    });
    scheduleMc1(db, {
      personaId: "kei-ochiai",
      approvedText: "c",
      targetWindowName: "w",
    });
    const n = cancelPendingByPersona(db, "ryo-ochiai");
    expect(n).toBe(2);
    expect(nextPendingByPersona(db, "ryo-ochiai")).toBeNull();
    expect(nextPendingByPersona(db, "kei-ochiai")).not.toBeNull();
  });

  it("retorna 0 quando nada pra cancelar", () => {
    expect(cancelPendingByPersona(db, "ryo-ochiai")).toBe(0);
  });

  it("não afeta delivered", () => {
    const rec = scheduleMc1(db, {
      personaId: "ryo-ochiai",
      approvedText: "a",
      targetWindowName: "w",
    });
    markDelivered(db, rec.id);
    expect(cancelPendingByPersona(db, "ryo-ochiai")).toBe(0);
    expect(getById(db, rec.id)?.status).toBe("delivered");
  });
});
