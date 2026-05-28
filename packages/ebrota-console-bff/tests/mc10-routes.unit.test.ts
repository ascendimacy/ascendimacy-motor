import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

const FLAG = "MC10_MOBILE_ONBOARDING";
const previousFlag = process.env[FLAG];

let server: BffServer;

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

const newServer = () => {
  const db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  return createBffServer({ daemon, db, logger: false });
};

describe("MC10 routes — feature flag enabled", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
    server = newServer();
  });
  afterEach(async () => {
    await server.close();
    if (previousFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previousFlag;
  });

  it("POST /mc10/mobile/start cria session + retorna firstPrompt", async () => {
    const res = await inject("POST", "/mc10/mobile/start");
    expect(res.status).toBe(200);
    expect(typeof res.body?.sessionId).toBe("string");
    expect(res.body?.currentStep).toBe("welcome");
    expect(res.body?.firstPrompt).toContain("Brota");
  });

  it("reply válido avança step (welcome → child_name)", async () => {
    const start = await inject("POST", "/mc10/mobile/start");
    const sid = start.body?.sessionId as string;
    const r = await inject("POST", `/mc10/mobile/${sid}/reply`, {
      text: "ok",
    });
    expect(r.status).toBe(200);
    expect(r.body?.complete).toBe(false);
    expect(r.body?.currentStep).toBe("child_name");
    expect(r.body?.nextPrompt).toContain("chama");
  });

  it("reply inválido retorna 400 com hint + currentStep preservado", async () => {
    const start = await inject("POST", "/mc10/mobile/start");
    const sid = start.body?.sessionId as string;
    // avança até child_age
    await inject("POST", `/mc10/mobile/${sid}/reply`, { text: "ok" }); // welcome
    await inject("POST", `/mc10/mobile/${sid}/reply`, { text: "Ryo" }); // child_name
    const bad = await inject("POST", `/mc10/mobile/${sid}/reply`, {
      text: "sei lá",
    });
    expect(bad.status).toBe(400);
    expect(bad.body?.currentStep).toBe("child_age");
    expect(bad.body?.hint).toBeTruthy();
    expect(bad.body?.retryPrompt).toContain("anos");
  });

  it("completion → completionPayload retornado, session marked complete", async () => {
    const start = await inject("POST", "/mc10/mobile/start");
    const sid = start.body?.sessionId as string;
    const replies = [
      "ok", // welcome
      "Ryo", // child_name
      "8", // child_age
      "português, japonês", // child_languages
      "Quero que seja curioso e gentil.", // telos
      "tarde e noite", // daily_window
      "sim", // consent
    ];
    let last: Record<string, unknown> | null = null;
    for (const text of replies) {
      const r = await inject("POST", `/mc10/mobile/${sid}/reply`, { text });
      expect(r.status).toBe(200);
      last = r.body;
    }
    expect(last?.complete).toBe(true);
    const payload = last?.completionPayload as Record<string, unknown>;
    expect(payload.childName).toBe("Ryo");
    expect(payload.childAge).toBe(8);
    expect(payload.childLanguages).toEqual(["português", "japonês"]);
    expect(payload.dailyWindow).toEqual(["tarde", "noite"]);
    expect(payload.consentGranted).toBe(true);
  });

  it("GET status retorna current step + replies acumulados", async () => {
    const start = await inject("POST", "/mc10/mobile/start");
    const sid = start.body?.sessionId as string;
    await inject("POST", `/mc10/mobile/${sid}/reply`, { text: "ok" });
    await inject("POST", `/mc10/mobile/${sid}/reply`, { text: "Kei" });

    const status = await inject("GET", `/mc10/mobile/${sid}`);
    expect(status.status).toBe(200);
    expect(status.body?.currentStep).toBe("child_age");
    expect(status.body?.complete).toBe(false);
    expect(status.body?.childName).toBe("Kei");
    const replies = status.body?.replies as Record<string, unknown>;
    expect(replies.child_name).toBeDefined();
    expect(replies.welcome).toBeDefined();
  });

  it("GET status 404 quando session inexistente", async () => {
    const status = await inject("GET", `/mc10/mobile/does-not-exist`);
    expect(status.status).toBe(404);
  });

  it("idempotency: replies após complete retornam mesmo payload sem avançar", async () => {
    const start = await inject("POST", "/mc10/mobile/start");
    const sid = start.body?.sessionId as string;
    const replies = [
      "ok",
      "Ryo",
      "8",
      "português",
      "telos curto",
      "manhã",
      "sim",
    ];
    for (const text of replies) {
      await inject("POST", `/mc10/mobile/${sid}/reply`, { text });
    }
    const status1 = await inject("GET", `/mc10/mobile/${sid}`);
    expect(status1.body?.complete).toBe(true);

    // re-reply após complete: retorna payload sem mudar estado
    const replay = await inject("POST", `/mc10/mobile/${sid}/reply`, {
      text: "qualquer coisa",
    });
    expect(replay.status).toBe(200);
    expect(replay.body?.complete).toBe(true);
    expect(replay.body?.completionPayload).toBeDefined();
  });

  it("POST /reply body sem text → 400", async () => {
    const start = await inject("POST", "/mc10/mobile/start");
    const sid = start.body?.sessionId as string;
    const r = await inject("POST", `/mc10/mobile/${sid}/reply`, {});
    expect(r.status).toBe(400);
  });
});

describe("MC10 routes — feature flag OFF", () => {
  beforeEach(() => {
    delete process.env[FLAG];
    server = newServer();
  });
  afterEach(async () => {
    await server.close();
    if (previousFlag !== undefined) process.env[FLAG] = previousFlag;
  });

  it("503 em /mc10/mobile/start", async () => {
    const r = await inject("POST", "/mc10/mobile/start");
    expect(r.status).toBe(503);
    expect(r.body?.error).toContain("disabled");
  });

  it("503 em /mc10/mobile/:sessionId/reply", async () => {
    const r = await inject("POST", "/mc10/mobile/whatever/reply", {
      text: "x",
    });
    expect(r.status).toBe(503);
  });

  it("503 em GET /mc10/mobile/:sessionId", async () => {
    const r = await inject("GET", "/mc10/mobile/whatever");
    expect(r.status).toBe(503);
  });
});
