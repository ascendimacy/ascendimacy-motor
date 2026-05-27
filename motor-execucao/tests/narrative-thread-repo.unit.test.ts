import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  NARRATIVE_THREADS_DDL,
  openThread,
  resumeThread,
  closeThread,
  listOpen,
  markStale,
  getThread,
} from "../src/narrative-thread-repo.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(NARRATIVE_THREADS_DDL);
});

afterEach(() => {
  db.close();
});

const OPENED_AT = "2026-05-20T10:00:00Z";

describe("narrative-thread-repo CRUD", () => {
  it("openThread persiste com status=open, follow_up_triggered=false e stale_after default +7d", () => {
    const t = openThread(db, {
      persona_id: "saki-ochiai",
      opened_in_session: "s1",
      opened_at: OPENED_AT,
      thread_text: "queria saber por que o gato cinza foge da chuva",
    });
    expect(t.status).toBe("open");
    expect(t.follow_up_triggered).toBe(false);
    expect(t.persona_id).toBe("saki-ochiai");
    const expectedStale = new Date(
      Date.parse(OPENED_AT) + 7 * 86_400_000,
    ).toISOString();
    expect(t.stale_after).toBe(expectedStale);
    expect(t.id).toBeTruthy();
  });

  it("openThread aceita axis opcional e stale_after override", () => {
    const t = openThread(db, {
      persona_id: "ryo-ochiai",
      opened_in_session: "s2",
      opened_at: OPENED_AT,
      thread_text: "comparar dois desenhos do dragão antigos",
      axis: "spatial",
      stale_after: "2026-05-25T10:00:00Z",
    });
    expect(t.axis).toBe("spatial");
    expect(t.stale_after).toBe("2026-05-25T10:00:00Z");
  });

  it("getThread retorna null para id desconhecido", () => {
    expect(getThread(db, "no-such-id")).toBeNull();
  });

  it("resumeThread muda open → resumed e seta follow_up_triggered", () => {
    const t = openThread(db, {
      persona_id: "kei-ochiai",
      opened_in_session: "s3",
      opened_at: OPENED_AT,
      thread_text: "história do tubarão que tinha medo",
    });
    const updated = resumeThread(db, t.id);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("resumed");
    expect(updated!.follow_up_triggered).toBe(true);
  });

  it("resumeThread também aceita status=stale", () => {
    const t = openThread(db, {
      persona_id: "kei-ochiai",
      opened_in_session: "s3",
      opened_at: "2026-05-01T10:00:00Z",
      thread_text: "x",
    });
    markStale(db, "2026-05-20T10:00:00Z");
    const updated = resumeThread(db, t.id);
    expect(updated!.status).toBe("resumed");
  });

  it("resumeThread retorna null se thread já fechado", () => {
    const t = openThread(db, {
      persona_id: "kei-ochiai",
      opened_in_session: "s3",
      opened_at: OPENED_AT,
      thread_text: "x",
    });
    closeThread(db, t.id, "closed_natural", "2026-05-21T10:00:00Z");
    expect(resumeThread(db, t.id)).toBeNull();
  });

  it("closeThread aceita closed_natural | closed_abandoned e seta closed_at", () => {
    const t1 = openThread(db, {
      persona_id: "p",
      opened_in_session: "s",
      opened_at: OPENED_AT,
      thread_text: "x",
    });
    const c1 = closeThread(db, t1.id, "closed_natural", "2026-05-21T10:00:00Z");
    expect(c1!.status).toBe("closed_natural");
    expect(c1!.closed_at).toBe("2026-05-21T10:00:00Z");

    const t2 = openThread(db, {
      persona_id: "p",
      opened_in_session: "s",
      opened_at: OPENED_AT,
      thread_text: "y",
    });
    const c2 = closeThread(db, t2.id, "closed_abandoned", "2026-05-30T10:00:00Z");
    expect(c2!.status).toBe("closed_abandoned");
  });

  it("listOpen retorna apenas open + resumed da persona", () => {
    const a = openThread(db, {
      persona_id: "saki-ochiai",
      opened_in_session: "s1",
      opened_at: OPENED_AT,
      thread_text: "a",
    });
    const b = openThread(db, {
      persona_id: "saki-ochiai",
      opened_in_session: "s1",
      opened_at: OPENED_AT,
      thread_text: "b",
    });
    openThread(db, {
      persona_id: "ryo-ochiai",
      opened_in_session: "s1",
      opened_at: OPENED_AT,
      thread_text: "outro",
    });
    resumeThread(db, a.id);
    closeThread(db, b.id, "closed_natural", "2026-05-21T10:00:00Z");
    const open = listOpen(db, "saki-ochiai");
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(a.id);
    expect(open[0]!.status).toBe("resumed");
  });

  it("markStale marca open com stale_after < now", () => {
    openThread(db, {
      persona_id: "p",
      opened_in_session: "s",
      opened_at: "2026-05-01T10:00:00Z",
      thread_text: "antigo",
    });
    openThread(db, {
      persona_id: "p",
      opened_in_session: "s",
      opened_at: "2026-05-20T10:00:00Z",
      thread_text: "recente",
    });
    const marked = markStale(db, "2026-05-15T00:00:00Z");
    expect(marked).toBe(1);
    const open = listOpen(db, "p");
    expect(open).toHaveLength(1);
    expect(open[0]!.thread_text).toBe("recente");
  });

  it("markStale com thresholdDays sobrescreve política", () => {
    openThread(db, {
      persona_id: "p",
      opened_in_session: "s",
      opened_at: "2026-05-10T10:00:00Z",
      thread_text: "5d antigo",
      stale_after: "2099-01-01T00:00:00Z", // stored stale_after distante
    });
    // thresholdDays=3 → opened_at < (now - 3d) ?
    const marked = markStale(db, "2026-05-20T10:00:00Z", 3);
    expect(marked).toBe(1);
  });
});
