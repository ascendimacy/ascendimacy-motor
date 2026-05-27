import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
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
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

beforeEach(() => {
  const db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  fixturesDir = mkdtempSync(join(tmpdir(), "ebrota-parental-test-"));
  server = createBffServer({
    daemon,
    db,
    logger: false,
    fixturesDir,
  });
});

afterEach(async () => {
  await server.close();
  if (existsSync(fixturesDir)) {
    rmSync(fixturesDir, { recursive: true, force: true });
  }
});

const sampleState = (overrides?: Record<string, unknown>) => ({
  step: 11,
  mc10ReadAt: "2026-05-27T10:00:00.000Z",
  family: {
    acquirer: { id: "yuji-ochiai", name: "Yuji", relation: "pai" },
    coParent: null,
    children: [
      { id: "ryo-ochiai", name: "Ryo", age: 8, primaryLanguage: "pt" },
    ],
  },
  telos: {
    text: "Queremos que cresçam bilíngues e curiosos.",
    tags: ["bilinguismo", "curiosidade"],
  },
  forbiddenZones: [
    { topic: "violência gráfica", policy: "never", reason: "default" },
  ],
  budget: {
    sacrificeBudgetCap: 100,
    offScreenRatio: 2,
    sessionMinutesCap: 15,
  },
  virtuesByChild: {
    "ryo-ochiai": [{ axis: 1 }, { axis: 5 }],
  },
  windowsByChild: {
    "ryo-ochiai": { mon: "window1", tue: "window1" },
  },
  consents: {
    storeTrace: true,
    emitPhysicalCards: true,
    activeHoursMessaging: true,
    confirmIsAi: true,
  },
  dyad: null,
  mc1Approvals: [
    { childId: "ryo-ochiai", text: "Oi Ryo!", approved: true },
  ],
  readyForPilot: false,
  ...overrides,
});

describe("GET /parental/mc10-material", () => {
  it("retorna bullets + frases JP", async () => {
    const res = await inject("GET", "/parental/mc10-material");
    expect(res.status).toBe(200);
    const body = res.body as {
      beforeBullets: string[];
      duringBullets: string[];
      afterBullets: string[];
      jpPhrases: Array<{ pt: string; jp: string }>;
      escalationPath: string;
    };
    expect(body.beforeBullets.length).toBeGreaterThan(0);
    expect(body.duringBullets.length).toBeGreaterThan(0);
    expect(body.jpPhrases.length).toBeGreaterThan(0);
    expect(typeof body.escalationPath).toBe("string");
  });
});

describe("POST /parental/onboarding/draft (idempotente)", () => {
  it("salva e atualiza idempotentemente", async () => {
    const r1 = await inject("POST", "/parental/onboarding/draft", {
      step: 3,
      family: { acquirer: { id: "yuji-ochiai", name: "Yuji" } },
    });
    expect(r1.status).toBe(200);
    expect((r1.body as { acquirerId: string }).acquirerId).toBe("yuji-ochiai");

    // Re-save com step diferente — não cria novo registro.
    const r2 = await inject("POST", "/parental/onboarding/draft", {
      step: 5,
      family: { acquirer: { id: "yuji-ochiai", name: "Yuji" } },
    });
    expect(r2.status).toBe(200);
    expect((r2.body as { step: number }).step).toBe(5);
  });

  it("400 quando body inválido", async () => {
    const res = await inject("POST", "/parental/onboarding/draft", null);
    expect(res.status).toBe(400);
  });
});

describe("GET /parental/onboarding/status", () => {
  it("retorna not_started quando vazio", async () => {
    const res = await inject("GET", "/parental/onboarding/status");
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("not_started");
  });

  it("retorna step + status após draft", async () => {
    await inject("POST", "/parental/onboarding/draft", {
      step: 4,
      family: { acquirer: { id: "yuji-ochiai", name: "Yuji" } },
    });
    const res = await inject("GET", "/parental/onboarding/status");
    expect((res.body as { step: number; status: string }).step).toBe(4);
    expect((res.body as { status: string }).status).toBe("in_progress");
  });
});

describe("POST /parental/onboarding/complete", () => {
  it("escreve YAML + retorna status complete", async () => {
    const res = await inject(
      "POST",
      "/parental/onboarding/complete",
      sampleState(),
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      acquirerId: string;
      status: string;
      yamlPath: string | null;
      event: string;
    };
    expect(body.status).toBe("complete");
    expect(body.event).toBe("persona_ready_for_pilot");
    expect(body.yamlPath).toMatch(/parental-profile-yuji-ochiai\.yaml$/);
    expect(existsSync(body.yamlPath!)).toBe(true);

    const yaml = readFileSync(body.yamlPath!, "utf8");
    expect(yaml).toContain("Yuji");
    expect(yaml).toContain("bilinguismo");
    expect(yaml).toContain("Ryo");
  });

  it("400 quando não tem crianças", async () => {
    const state = sampleState({ family: { acquirer: { id: "x", name: "X" }, children: [] } });
    const res = await inject("POST", "/parental/onboarding/complete", state);
    expect(res.status).toBe(400);
  });

  it("marca status como complete em /status após finalizar", async () => {
    await inject("POST", "/parental/onboarding/complete", sampleState());
    const status = await inject("GET", "/parental/onboarding/status");
    expect((status.body as { status: string }).status).toBe("complete");
    expect((status.body as { completedAt: string }).completedAt).toBeTruthy();
  });
});

describe("POST /parental/mc1/preview", () => {
  it("gera texto incluindo nome da criança", async () => {
    const res = await inject("POST", "/parental/mc1/preview", {
      personaId: "ryo-ochiai",
      childName: "Ryo",
      age: 8,
      language: "pt",
      telos: { text: "", tags: ["bilinguismo", "curiosidade"] },
      virtues: [{ axis: 1 }],
    });
    expect(res.status).toBe(200);
    const body = res.body as { text: string };
    expect(body.text).toContain("Ryo");
    expect(body.text.toLowerCase()).toContain("brota");
  });

  it("adiciona JP quando language=jp", async () => {
    const res = await inject("POST", "/parental/mc1/preview", {
      childName: "Kei",
      language: "jp",
    });
    expect(res.status).toBe(200);
    const body = res.body as { text: string };
    expect(body.text).toMatch(/ブロータ/);
  });

  it("400 quando childName ausente", async () => {
    const res = await inject("POST", "/parental/mc1/preview", {});
    expect(res.status).toBe(400);
  });
});
