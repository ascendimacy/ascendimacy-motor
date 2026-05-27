/**
 * Parental Engaged Dashboard — view "dia dos meus filhos" (US-PE-01..09).
 *
 * Plugin Fastify registrado em server.ts. V0 retorna stubs determinísticos
 * estruturados conforme a forma final, com a flag `developmentStub: true`
 * sinalizando ao UI que aquele bloco ainda não vem do motor real. Conforme
 * subsistemas amadurecerem (S1/S2/S5/B1), cada handler troca o stub por
 * leitura de repos sem mudar shape de resposta.
 *
 * Spec: docs/specs/2026-05-26-console-ebrota-user-stories-v0.md §"Parental
 * Journey — Navigation Flows".
 */

import type { FastifyPluginAsync } from "fastify";

export interface KidSummary {
  childId: string;
  name: string;
  age: number;
  primaryLanguage: string;
  avatarColor: string;
  engagedToday: boolean;
  lastSeenAt: string | null;
  moodToday: number | null;
  durationMinutesToday: number;
  oneLineSummary: string;
  developmentStub?: boolean;
}

export interface DashboardResponse {
  acquirerId: string;
  acquirerName: string;
  generatedAt: string;
  pendingQuestionsCount: number;
  unreadAlertsCount: number;
  children: KidSummary[];
}

export interface TodaySummary {
  childId: string;
  date: string;
  engaged: boolean;
  moodAverage: number | null;
  durationMinutes: number;
  topicsDiscussed: string[];
  lastMessagePreview: string | null;
  lastSeenAt: string | null;
  cardsEmittedToday: number;
  developmentStub?: boolean;
}

export interface WeekProgress {
  childId: string;
  weekStartIso: string;
  weekEndIso: string;
  moodTimeline: Array<{ date: string; mood: number | null }>;
  moodAverage: number | null;
  cardsCount: number;
  cardThumbnails: Array<{ cardId: string; title: string; rarity: string }>;
  sacrificeBudgetTotal: number;
  sacrificeBudgetUsed: number;
  offScreenRatio: number;
  topThemes: string[];
  qualitativeSummary: string;
  developmentStub?: boolean;
}

export interface PhysicalCard {
  cardId: string;
  title: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  emittedAt: string;
  thumbnailUrl: string;
  qrCodePayload: string;
  cheatCode: string;
  pdfUrl: string;
  used: boolean;
}

export interface ConversationSession {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  durationMinutes: number;
  topicSummary: string;
  preview: Array<{ from: "kid" | "brota"; text: string; at: string }>;
  developmentStub?: boolean;
}

export interface ParentalAlert {
  alertId: string;
  type: "distress" | "drift" | "negative_sequence" | "other";
  severity: "info" | "warn" | "critical";
  raisedAt: string;
  context: string;
  excerpt: string;
  sessionRefs: string[];
  proposedAction: "pause_brota" | "contact_jun" | "wait" | "review";
  status: "open" | "ack" | "resolved";
  developmentStub?: boolean;
}

export interface PulsoEvent {
  eventId: string;
  type: "omikuji" | "mini_historia" | "lembrete_cultural" | "outro";
  firedAt: string;
  windowLabel: string;
  culturalContext: string;
  payloadPreview: string;
  kidReaction: "engaged" | "ignored" | "positive" | "negative" | "unknown";
  developmentStub?: boolean;
}

export interface PendingQuestion {
  questionId: string;
  childId: string;
  raisedAt: string;
  brotaContextTurns: Array<{ from: "kid" | "brota"; text: string }>;
  rawQuestion: string;
  escalationReason: string;
  status: "open" | "answered";
  developmentStub?: boolean;
}

export interface ParentalDashboardOptions {
  /**
   * Resolver de família/crianças. V0 default retorna a família Yuji
   * (Ryo/Kei/Saki) — em prod, virá de parental-onboarding-store ou
   * subject-knowledge-repo.
   */
  resolveFamily?: (acquirerId: string) => {
    acquirerName: string;
    children: Array<{
      childId: string;
      name: string;
      age: number;
      primaryLanguage: string;
      avatarColor: string;
    }>;
  };
}

const DEFAULT_FAMILY = {
  acquirerName: "Yuji",
  children: [
    {
      childId: "ryo-ochiai",
      name: "Ryo",
      age: 8,
      primaryLanguage: "pt",
      avatarColor: "#5B8DEF",
    },
    {
      childId: "kei-ochiai",
      name: "Kei",
      age: 6,
      primaryLanguage: "pt",
      avatarColor: "#F2A65A",
    },
    {
      childId: "saki-ochiai",
      name: "Saki",
      age: 4,
      primaryLanguage: "pt",
      avatarColor: "#E36588",
    },
  ],
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function pseudoRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function isoDaysAgo(days: number, hoursOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hoursOffset);
  return d.toISOString();
}

function isoHoursAgo(hours: number): string {
  const d = new Date(Date.now() - hours * 3600_000);
  return d.toISOString();
}

const parentalDashboardRoutes: FastifyPluginAsync<
  ParentalDashboardOptions
> = async (fastify, opts) => {
  const resolveFamily =
    opts.resolveFamily ?? ((_id: string) => DEFAULT_FAMILY);

  // GET /parental/dashboard/:acquirerId → US-PE-01 agregado.
  fastify.get<{ Params: { acquirerId: string } }>(
    "/parental/dashboard/:acquirerId",
    async (req) => {
      const fam = resolveFamily(req.params.acquirerId);
      const rng = pseudoRandom(hashSeed(req.params.acquirerId));
      const children: KidSummary[] = fam.children.map((c) => {
        const engaged = rng() > 0.25;
        const mood = engaged ? Math.round(5 + rng() * 4 * 10) / 10 : null;
        const minutes = engaged ? Math.round(3 + rng() * 12) : 0;
        const topic = ["joaninhas", "estrelas", "dinossauros", "Pokémon", "música"][
          Math.floor(rng() * 5)
        ];
        const hoursAgo = engaged ? Math.round(rng() * 8 + 1) : 36;
        return {
          childId: c.childId,
          name: c.name,
          age: c.age,
          primaryLanguage: c.primaryLanguage,
          avatarColor: c.avatarColor,
          engagedToday: engaged,
          lastSeenAt: engaged ? isoHoursAgo(hoursAgo) : isoHoursAgo(36),
          moodToday: mood,
          durationMinutesToday: minutes,
          oneLineSummary: engaged
            ? `${c.name} conversou ${minutes}min, falou sobre ${topic}`
            : `${c.name} não interagiu hoje`,
          developmentStub: true,
        };
      });
      const response: DashboardResponse = {
        acquirerId: req.params.acquirerId,
        acquirerName: fam.acquirerName,
        generatedAt: new Date().toISOString(),
        pendingQuestionsCount: 1,
        unreadAlertsCount: 0,
        children,
      };
      return response;
    },
  );

  // GET /parental/children/:childId/today → US-PE-01 drill-in.
  fastify.get<{ Params: { childId: string } }>(
    "/parental/children/:childId/today",
    async (req) => {
      const rng = pseudoRandom(hashSeed(req.params.childId + "today"));
      const engaged = rng() > 0.25;
      const minutes = engaged ? Math.round(3 + rng() * 12) : 0;
      const moodAvg = engaged ? Math.round(5 + rng() * 4) : null;
      const today = new Date().toISOString().slice(0, 10);
      const result: TodaySummary = {
        childId: req.params.childId,
        date: today,
        engaged,
        moodAverage: moodAvg,
        durationMinutes: minutes,
        topicsDiscussed: engaged ? ["joaninhas", "cores do céu"] : [],
        lastMessagePreview: engaged
          ? "Brota: que cor de joaninha você mais gosta?"
          : null,
        lastSeenAt: engaged ? isoHoursAgo(2) : null,
        cardsEmittedToday: engaged ? 1 : 0,
        developmentStub: true,
      };
      return result;
    },
  );

  // GET /parental/children/:childId/week → US-PE-02.
  fastify.get<{ Params: { childId: string } }>(
    "/parental/children/:childId/week",
    async (req) => {
      const rng = pseudoRandom(hashSeed(req.params.childId + "week"));
      const timeline: Array<{ date: string; mood: number | null }> = [];
      let moodSum = 0;
      let moodCount = 0;
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const has = rng() > 0.2;
        const mood = has ? Math.round((5 + rng() * 4) * 10) / 10 : null;
        if (mood !== null) {
          moodSum += mood;
          moodCount++;
        }
        timeline.push({ date: d.toISOString().slice(0, 10), mood });
      }
      const result: WeekProgress = {
        childId: req.params.childId,
        weekStartIso: timeline[0]!.date,
        weekEndIso: timeline[timeline.length - 1]!.date,
        moodTimeline: timeline,
        moodAverage:
          moodCount > 0 ? Math.round((moodSum / moodCount) * 10) / 10 : null,
        cardsCount: Math.floor(rng() * 4) + 1,
        cardThumbnails: [
          { cardId: "card-joaninhas", title: "Joaninhas", rarity: "common" },
          { cardId: "card-estrelas", title: "Estrelas", rarity: "rare" },
        ],
        sacrificeBudgetTotal: 100,
        sacrificeBudgetUsed: Math.floor(rng() * 40) + 20,
        offScreenRatio: Math.round((1.5 + rng() * 1.5) * 10) / 10,
        topThemes: ["joaninhas", "estrelas", "dinossauros"],
        qualitativeSummary:
          "Semana com mood estável (~7), forte interesse em natureza " +
          "(joaninhas e estrelas). Sem sinais de drift; engajamento " +
          "consistente nas janelas configuradas.",
        developmentStub: true,
      };
      return result;
    },
  );

  // GET /parental/children/:childId/cards → US-PE-03.
  fastify.get<{ Params: { childId: string } }>(
    "/parental/children/:childId/cards",
    async (req) => {
      const cid = req.params.childId;
      const cards: PhysicalCard[] = [
        {
          cardId: `${cid}-card-joaninhas-001`,
          title: "Joaninhas amarelas",
          rarity: "common",
          emittedAt: isoDaysAgo(2),
          thumbnailUrl: "/placeholder-card-joaninhas.png",
          qrCodePayload: `ebrota://card/${cid}/joaninhas-001`,
          cheatCode: "BR-JOA-001",
          pdfUrl: `/api/parental/children/${cid}/cards/joaninhas-001.pdf`,
          used: false,
        },
        {
          cardId: `${cid}-card-estrelas-002`,
          title: "Estrelas e constelações",
          rarity: "rare",
          emittedAt: isoDaysAgo(5),
          thumbnailUrl: "/placeholder-card-estrelas.png",
          qrCodePayload: `ebrota://card/${cid}/estrelas-002`,
          cheatCode: "BR-EST-002",
          pdfUrl: `/api/parental/children/${cid}/cards/estrelas-002.pdf`,
          used: true,
        },
      ];
      return { childId: cid, cards, developmentStub: true };
    },
  );

  // GET /parental/children/:childId/conversations → US-PE-05.
  fastify.get<{ Params: { childId: string }; Querystring: { limit?: string } }>(
    "/parental/children/:childId/conversations",
    async (req) => {
      const cid = req.params.childId;
      const limit = req.query.limit ? Number(req.query.limit) : 5;
      const sessions: ConversationSession[] = [];
      for (let i = 0; i < Math.min(limit, 5); i++) {
        sessions.push({
          sessionId: `${cid}-sess-${i}`,
          startedAt: isoDaysAgo(i),
          endedAt: isoDaysAgo(i, -1),
          turnCount: 8 + i,
          durationMinutes: 5 + i,
          topicSummary:
            i === 0 ? "joaninhas e cores do céu" : `tema do dia ${i}`,
          preview: [
            {
              from: "brota",
              text: "Oi! O que te chamou atenção hoje?",
              at: isoDaysAgo(i),
            },
            {
              from: "kid",
              text: "vi uma joaninha amarela!",
              at: isoDaysAgo(i),
            },
            {
              from: "brota",
              text: "Que sorte! Joaninha amarela é menos comum.",
              at: isoDaysAgo(i),
            },
          ],
          developmentStub: true,
        });
      }
      return { childId: cid, sessions };
    },
  );

  // GET /parental/children/:childId/alerts → US-PE-06.
  fastify.get<{ Params: { childId: string } }>(
    "/parental/children/:childId/alerts",
    async (req) => {
      const cid = req.params.childId;
      const alerts: ParentalAlert[] = [];
      return { childId: cid, alerts, developmentStub: true };
    },
  );

  // GET /parental/children/:childId/pulso-events → US-PE-08.
  fastify.get<{
    Params: { childId: string };
    Querystring: { type?: string; limit?: string };
  }>(
    "/parental/children/:childId/pulso-events",
    async (req) => {
      const cid = req.params.childId;
      const all: PulsoEvent[] = [
        {
          eventId: `${cid}-pulso-1`,
          type: "omikuji",
          firedAt: isoDaysAgo(1),
          windowLabel: "manhã (07:30)",
          culturalContext:
            "Omikuji — sorte do dia no estilo dos santuários japoneses. " +
            "Ryo conhece o costume via avô.",
          payloadPreview: "Hoje: 中吉 (chuu-kichi — sorte média). Tema: paciência.",
          kidReaction: "engaged",
          developmentStub: true,
        },
        {
          eventId: `${cid}-pulso-2`,
          type: "mini_historia",
          firedAt: isoDaysAgo(2),
          windowLabel: "tarde (17:00)",
          culturalContext:
            "Mini-história curta de 3 frases — uso reduzido pra não competir com janela do jantar.",
          payloadPreview:
            "A formiga carregava uma folha grande. O vento veio forte. Ela soltou — e a folha virou barco.",
          kidReaction: "positive",
          developmentStub: true,
        },
      ];
      const filtered =
        req.query.type !== undefined
          ? all.filter((e) => e.type === req.query.type)
          : all;
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      return { childId: cid, events: filtered.slice(0, limit) };
    },
  );

  // GET /parental/escalation/pending-questions → todas perguntas pendentes
  //   (não está no spec explicitamente, mas necessário pra badge + modal).
  fastify.get("/parental/escalation/pending-questions", async () => {
    const questions: PendingQuestion[] = [
      {
        questionId: "pq-001",
        childId: "saki-ochiai",
        raisedAt: isoHoursAgo(6),
        brotaContextTurns: [
          { from: "kid", text: "por que o céu fica vermelho?" },
          {
            from: "brota",
            text: "Boa pergunta — vou conferir com seu pai pra te explicar direitinho.",
          },
        ],
        rawQuestion: "por que o céu fica vermelho?",
        escalationReason:
          "tema científico fora do baseline garantido — pais decidem profundidade.",
        status: "open",
        developmentStub: true,
      },
    ];
    return { questions };
  });

  // POST /parental/escalation/pending-questions/:questionId/answer → US-PE-04.
  fastify.post<{
    Params: { questionId: string };
    Body: {
      answerText?: string;
      instructionToBrota?: string;
      tone?: string;
    };
  }>(
    "/parental/escalation/pending-questions/:questionId/answer",
    async (req, reply) => {
      const body = req.body ?? {};
      if (
        (typeof body.answerText !== "string" || body.answerText.length === 0) &&
        (typeof body.instructionToBrota !== "string" ||
          body.instructionToBrota.length === 0)
      ) {
        return reply.code(400).send({
          error: "answerText ou instructionToBrota obrigatório",
        });
      }
      return {
        questionId: req.params.questionId,
        status: "answered",
        scheduledForNextSession: true,
        recordedAt: new Date().toISOString(),
      };
    },
  );

  // POST /parental/escalation/report → US-PE-07.
  fastify.post<{
    Body: {
      childId?: string;
      type?: "tom" | "repeticao" | "off-topic" | "outro";
      text?: string;
      sessionRef?: string;
    };
  }>("/parental/escalation/report", async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body.childId !== "string" || body.childId.length === 0) {
      return reply.code(400).send({ error: "childId obrigatório" });
    }
    if (typeof body.type !== "string") {
      return reply.code(400).send({ error: "type obrigatório" });
    }
    if (
      typeof body.text !== "string" ||
      body.text.length === 0 ||
      body.text.length > 500
    ) {
      return reply
        .code(400)
        .send({ error: "text obrigatório, 1..500 chars" });
    }
    return {
      reportId: `rep-${Date.now()}`,
      childId: body.childId,
      type: body.type,
      status: "open",
      notifiedJun: true,
      createdAt: new Date().toISOString(),
    };
  });

  // POST /parental/children/:childId/pause → US-PE-09.
  fastify.post<{
    Params: { childId: string };
    Body: { reason?: string; pauseUntilIso?: string; immediate?: boolean };
  }>("/parental/children/:childId/pause", async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body.reason !== "string" || body.reason.length === 0) {
      return reply.code(400).send({ error: "reason obrigatório" });
    }
    const immediate = body.immediate !== false;
    return {
      childId: req.params.childId,
      paused: true,
      immediate,
      pauseUntilIso: body.pauseUntilIso ?? null,
      notifiedJun:
        typeof body.pauseUntilIso === "string" &&
        Date.parse(body.pauseUntilIso) - Date.now() > 24 * 3600_000,
      pausedAt: new Date().toISOString(),
    };
  });
};

export default parentalDashboardRoutes;
