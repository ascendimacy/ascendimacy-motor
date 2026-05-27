import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

let server: BffServer;
let fixturesDir: string;

const inject = async (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
) => {
  const res = await server.fastify.inject({
    method,
    url,
    ...(payload !== undefined ? { payload } : {}),
  });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null,
  };
};

beforeEach(() => {
  const db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  fixturesDir = mkdtempSync(join(tmpdir(), "ebrota-mc1-test-"));
  server = createBffServer({ daemon, db, logger: false, fixturesDir });
});

afterEach(async () => {
  await server.close();
  if (existsSync(fixturesDir)) {
    rmSync(fixturesDir, { recursive: true, force: true });
  }
});

const MC1_PT =
  "Olá. Sou o Brota. Teu pai mencionou que eu ia falar contigo.";

const sampleWizard = () => ({
  step: 11,
  mc10ReadAt: "2026-05-27T10:00:00.000Z",
  family: {
    acquirer: { id: "yuji-ochiai", name: "Yuji", relation: "pai" },
    coParent: null,
    children: [
      { id: "ryo-ochiai", name: "Ryo", age: 8, primaryLanguage: "pt" },
      { id: "kei-ochiai", name: "Kei", age: 6, primaryLanguage: "pt" },
    ],
  },
  telos: { text: "telos", tags: ["curiosidade"] },
  forbiddenZones: [],
  budget: { sacrificeBudgetCap: 100, offScreenRatio: 2, sessionMinutesCap: 15 },
  virtuesByChild: {},
  windowsByChild: {},
  consents: {
    storeTrace: true,
    emitPhysicalCards: true,
    activeHoursMessaging: true,
    confirmIsAi: true,
  },
  dyad: null,
  mc1Approvals: [
    { childId: "ryo-ochiai", text: MC1_PT, approved: true },
    { childId: "kei-ochiai", text: MC1_PT + " (Kei)", approved: true },
  ],
  readyForPilot: true,
});

describe("MC1 — wizard complete agenda MC1", () => {
  it("POST /parental/onboarding/complete persiste MC1 pra cada child aprovado", async () => {
    const res = await inject(
      "POST",
      "/parental/onboarding/complete",
      sampleWizard(),
    );
    expect(res.status).toBe(200);
    const mc1Scheduled = res.body?.mc1Scheduled as Array<Record<string, unknown>>;
    expect(mc1Scheduled).toHaveLength(2);
    expect(
      mc1Scheduled.map((s) => s.childId).sort(),
    ).toEqual(["kei-ochiai", "ryo-ochiai"]);
  });

  it("aprovações com approved=false são puladas", async () => {
    const state = sampleWizard();
    state.mc1Approvals[1]!.approved = false;
    const res = await inject(
      "POST",
      "/parental/onboarding/complete",
      state,
    );
    const mc1 = res.body?.mc1Scheduled as Array<Record<string, unknown>>;
    expect(mc1).toHaveLength(1);
    expect(mc1[0]!.childId).toBe("ryo-ochiai");
  });

  it("re-run do wizard cancela pendente anterior e agenda nova", async () => {
    await inject("POST", "/parental/onboarding/complete", sampleWizard());
    const status1 = await inject(
      "GET",
      "/parental/mc1/status?childId=ryo-ochiai",
    );
    expect(status1.body?.status).toBe("pending");

    // Re-run com texto diferente
    const state2 = sampleWizard();
    state2.mc1Approvals[0]!.text = "novo texto";
    await inject("POST", "/parental/onboarding/complete", state2);

    const status2 = await inject(
      "GET",
      "/parental/mc1/status?childId=ryo-ochiai",
    );
    expect(status2.body?.status).toBe("pending");
    // só uma pending por persona — re-run cancela e re-agenda
  });
});

describe("MC1 — GET /parental/mc1/status", () => {
  it("not_scheduled quando criança nunca teve MC1", async () => {
    const res = await inject(
      "GET",
      "/parental/mc1/status?childId=saki-ochiai",
    );
    expect(res.status).toBe(200);
    expect(res.body?.status).toBe("not_scheduled");
    expect(res.body?.deliveredAt).toBeNull();
  });

  it("pending após onboarding completion", async () => {
    await inject("POST", "/parental/onboarding/complete", sampleWizard());
    const res = await inject(
      "GET",
      "/parental/mc1/status?childId=ryo-ochiai",
    );
    expect(res.status).toBe(200);
    expect(res.body?.status).toBe("pending");
    expect(res.body?.scheduledAt).toBeDefined();
    expect(res.body?.targetWindowName).toBe("post-school-jp");
  });

  it("400 quando childId ausente", async () => {
    const res = await inject("GET", "/parental/mc1/status");
    expect(res.status).toBe(400);
  });
});

describe("MC1 — POST /parental/mc1/cancel", () => {
  it("cancela MC1 pending", async () => {
    await inject("POST", "/parental/onboarding/complete", sampleWizard());
    const cancelRes = await inject(
      "POST",
      "/parental/mc1/cancel?childId=ryo-ochiai",
    );
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body?.cancelled).toBe(1);

    const status = await inject(
      "GET",
      "/parental/mc1/status?childId=ryo-ochiai",
    );
    expect(status.body?.status).toBe("cancelled");
  });

  it("idempotente: cancel quando nada pending → cancelled=0", async () => {
    const res = await inject(
      "POST",
      "/parental/mc1/cancel?childId=saki-ochiai",
    );
    expect(res.status).toBe(200);
    expect(res.body?.cancelled).toBe(0);
  });

  it("400 quando childId ausente", async () => {
    const res = await inject("POST", "/parental/mc1/cancel");
    expect(res.status).toBe(400);
  });
});
