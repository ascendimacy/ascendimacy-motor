/**
 * Tests sub-PR Strategist context — planejador hidrata contextHints
 * com subject_proposed + latent_needs do parental_profile.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { planTurn } from "../src/plan.js";

process.env["USE_MOCK_LLM"] = "true";

const mockState = {
  sessionId: "s-strategist-ctx",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
};

const mockAdquirente = {
  id: "jun",
  name: "Jun Ochiai",
  defaults: { style: "direto", language: "pt-br" },
};

const mockInventory = [
  {
    id: "kids.helix.session",
    title: "Helix",
    category: "kids",
    estimatedSacrifice: 1,
    estimatedConfidenceGain: 4,
  },
];

beforeAll(() => {});

describe("planTurn — Strategist context propagation", () => {
  it("injeta subject_proposed em contextHints quando parental_profile.aspirations existe", async () => {
    const persona = {
      id: "ryo",
      name: "Ryo",
      age: 13,
      profile: {
        parental_profile: {
          aspirations: {
            proposed_virtues: [
              { axis: 3 },
              { axis: 7 },
              { axis: 11 },
            ],
          },
        },
      },
    };
    const output = await planTurn({
      sessionId: mockState.sessionId,
      persona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    const subjectProposed = output.contextHints["subject_proposed"] as
      | { axes_active: number[] }
      | undefined;
    expect(subjectProposed).toBeDefined();
    expect(subjectProposed?.axes_active).toEqual([3, 7, 11]);
  });

  it("injeta latent_needs em contextHints quando parental_profile.latent_needs existe", async () => {
    const persona = {
      id: "ryo",
      name: "Ryo",
      age: 13,
      profile: {
        parental_profile: {
          latent_needs: ["autocontrole", "abertura emocional"],
        },
      },
    };
    const output = await planTurn({
      sessionId: mockState.sessionId,
      persona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["latent_needs"]).toEqual([
      "autocontrole",
      "abertura emocional",
    ]);
  });

  it("ambos juntos quando parental_profile completo", async () => {
    const persona = {
      id: "ryo",
      name: "Ryo",
      age: 13,
      profile: {
        parental_profile: {
          aspirations: {
            proposed_virtues: [{ axis: 4 }],
          },
          latent_needs: ["x"],
        },
      },
    };
    const output = await planTurn({
      sessionId: mockState.sessionId,
      persona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["subject_proposed"]).toBeDefined();
    expect(output.contextHints["latent_needs"]).toEqual(["x"]);
  });

  it("omite ambos quando parental_profile não tem aspirations nem latent_needs", async () => {
    const persona = {
      id: "ryo",
      name: "Ryo",
      age: 13,
      profile: {
        parental_profile: {
          // só campos do core sem Subject Knowledge fields
          family_values: { principles: ["x"] },
        },
      },
    };
    const output = await planTurn({
      sessionId: mockState.sessionId,
      persona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["subject_proposed"]).toBeUndefined();
    expect(output.contextHints["latent_needs"]).toBeUndefined();
  });

  it("backcompat — persona sem parental_profile inteiro", async () => {
    const persona = {
      id: "ryo",
      name: "Ryo",
      age: 13,
      profile: { interests: ["x"] },
    };
    const output = await planTurn({
      sessionId: mockState.sessionId,
      persona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["subject_proposed"]).toBeUndefined();
    expect(output.contextHints["latent_needs"]).toBeUndefined();
  });
});
