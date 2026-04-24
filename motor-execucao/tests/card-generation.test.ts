import { describe, it, expect } from "vitest";
import {
  detectAchievement,
  proposeCardSpec,
  selectArchetypeForSignal,
  triageCardSpec,
  generateCardImage,
  signCardAuthenticity,
  emitCard,
  SACRIFICE_HIGH_THRESHOLD,
  IGNITION_CHANNELS_MIN,
} from "../src/card-generation.js";
import {
  MockCardImageProvider,
  verifyCardSignature,
} from "@ascendimacy/shared";
import type { CardArchetype, ParentalProfile } from "@ascendimacy/shared";
import { loadArchetypes } from "../src/archetype-loader.js";

const SECRET = "test-secret-very-secret-0000";
const NOW = "2026-04-24T12:00:00Z";

const allArchetypes: CardArchetype[] = loadArchetypes();

// Forçamos um archetype NÃO-scaffold pra testar path feliz em env != test.
const nonScaffoldArchetype: CardArchetype = {
  id: "arch_test_real",
  name: "Test Real",
  narrative_template: "{child_name}, bom trabalho.",
  casel_dimension: "SM",
  gardner_channel: "logical_mathematical",
  rarity: "rare",
  is_scaffold: false,
};

describe("detectAchievement", () => {
  it("retorna null sem sinais", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
    });
    expect(r).toBeNull();
  });

  it("detecta status_to_pasto quando dim passou de baia→pasto", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      previous_matrix: { cognitive_math: "baia" },
      current_matrix: { cognitive_math: "pasto" },
    });
    expect(r?.kind).toBe("status_to_pasto");
  });

  it("não detecta quando dim já estava pasto", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      previous_matrix: { emotional: "pasto" },
      current_matrix: { emotional: "pasto" },
    });
    expect(r).toBeNull();
  });

  it("detecta ignition com ≥3 Gardner × ≥2 CASEL", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    expect(r?.kind).toBe("ignition");
  });

  it("não detecta ignition com <3 canais", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical"],
      casel_touched: ["SA", "DM"],
    });
    expect(r).toBeNull();
  });

  it("detecta sacrifice_high", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      sacrifice_spent: SACRIFICE_HIGH_THRESHOLD + 1,
    });
    expect(r?.kind).toBe("sacrifice_high");
  });

  it("prioriza pasto > ignition > sacrifice", () => {
    const r = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      previous_matrix: { cognitive_math: "baia" },
      current_matrix: { cognitive_math: "pasto" },
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
      sacrifice_spent: 20,
    });
    expect(r?.kind).toBe("status_to_pasto");
  });
});

describe("selectArchetypeForSignal", () => {
  const archetypes = allArchetypes;
  it("prefere match casel+rarity", () => {
    const signal = {
      child_id: "ryo",
      session_id: "s1",
      timestamp: NOW,
      kind: "ignition" as const,
      context_word: "x",
      casel_dimension: "REL" as const,
      gardner_channel: "linguistic" as const,
      achievement_summary: "x",
    };
    const a = selectArchetypeForSignal(signal, archetypes);
    // ignition → epic → arch_teacher (REL+epic no seed)
    expect(a?.id).toBe("arch_teacher_v0");
  });

  it("fallback pra rarity quando casel não bate", () => {
    const signal = {
      child_id: "ryo",
      session_id: "s1",
      timestamp: NOW,
      kind: "status_to_pasto" as const,
      context_word: "x",
      casel_dimension: "DM" as const,
      gardner_channel: "linguistic" as const,
      achievement_summary: "x",
    };
    // status_to_pasto → legendary; seed tem arch_crossing legendary com SA
    const a = selectArchetypeForSignal(signal, archetypes);
    expect(a?.rarity).toBe("legendary");
  });

  it("retorna null com archetypes vazio", () => {
    const signal = {
      child_id: "ryo",
      session_id: "s1",
      timestamp: NOW,
      kind: "ignition" as const,
      context_word: "x",
      casel_dimension: "SA" as const,
      gardner_channel: "linguistic" as const,
      achievement_summary: "x",
    };
    expect(selectArchetypeForSignal(signal, [])).toBeNull();
  });
});

describe("triageCardSpec (reuso do Bloco 4 triageForParents)", () => {
  const profile: ParentalProfile = {
    id: "yuji",
    role: "primary",
    decision_profile: "consultative_risk_averse",
    family_values: { principles: ["x"] },
    forbidden_zones: [{ topic: "violence", reason: "teste" }],
    budget_constraints: {},
    parental_availability: {},
  };

  it("approved=true quando profile ausente (skip)", async () => {
    const spec = proposeCardSpec(
      {
        child_id: "r",
        session_id: "s",
        timestamp: NOW,
        kind: "ignition",
        context_word: "biology",
        casel_dimension: "SA",
        gardner_channel: "linguistic",
        achievement_summary: "summary",
      },
      nonScaffoldArchetype,
      1,
    );
    const r = await triageCardSpec(spec, undefined);
    expect(r.approved).toBe(true);
    expect(r.triage_mode).toBe("skipped_no_profile");
  });

  it("rejeita quando summary contém forbidden topic", async () => {
    const spec = proposeCardSpec(
      {
        child_id: "r",
        session_id: "s",
        timestamp: NOW,
        kind: "ignition",
        context_word: "violence_topic",
        casel_dimension: "SA",
        gardner_channel: "linguistic",
        achievement_summary: "cena de violence forte",
      },
      nonScaffoldArchetype,
      1,
    );
    const r = await triageCardSpec(spec, profile);
    expect(r.approved).toBe(false);
    expect(r.reject_reason).toMatch(/violence/);
  });
});

describe("generateCardImage + signCardAuthenticity", () => {
  it("generateCardImage devolve data URL", async () => {
    const spec = proposeCardSpec(
      {
        child_id: "r",
        session_id: "s",
        timestamp: NOW,
        kind: "ignition",
        context_word: "biology",
        casel_dimension: "SA",
        gardner_channel: "linguistic",
        achievement_summary: "x",
      },
      nonScaffoldArchetype,
      1,
    );
    const img = await generateCardImage(spec, new MockCardImageProvider());
    expect(img.image_url).toMatch(/^data:image\/png/);
  });

  it("signCardAuthenticity produz signature verificável", () => {
    const { signature, qr_payload } = signCardAuthenticity(
      "abc-123",
      "ryo",
      NOW,
      SECRET,
    );
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(qr_payload).toContain(signature);
    expect(
      verifyCardSignature({
        card_id: "abc-123",
        child_id: "ryo",
        issued_at: NOW,
        secret: SECRET,
        signature,
      }),
    ).toBe(true);
  });
});

describe("emitCard — pipeline end-to-end + scaffold guard", () => {
  const signal = {
    child_id: "ryo",
    session_id: "s1",
    timestamp: "2026-04-24T10:00:00Z",
    kind: "ignition" as const,
    context_word: "biology",
    casel_dimension: "SA" as const,
    gardner_channel: "linguistic" as const,
    achievement_summary: "ignição multi-canal",
  };

  it("emite card completo com env=test mesmo com scaffold", async () => {
    const scaffoldArchetype = allArchetypes[0]!; // arch_persistence_v0 (is_scaffold: true)
    expect(scaffoldArchetype.is_scaffold).toBe(true);
    const spec = proposeCardSpec(signal, scaffoldArchetype, 1);
    const image = await new MockCardImageProvider().generateImage(spec);
    const card = emitCard({
      spec,
      approved_at: "2026-04-24T11:00:00Z",
      emitted_at: "2026-04-24T12:00:00Z",
      image,
      secret: SECRET,
      env: "test",
      child_name: "Ryo",
    });
    expect(card.card_id).toBeTruthy();
    expect(card.front.image_url).toBe(image.image_url);
    expect(card.front.narrative).toContain("Ryo");
    expect(card.back.serial_number).toBe("#ryo-001");
    expect(card.back.template).toBe("v1-default");
    expect(card.back.cheat_code).toContain("biology");
    expect(card.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(card.issued_at).toBe(signal.timestamp);
    expect(card.approved_at).toBe("2026-04-24T11:00:00Z");
    expect(card.emitted_at).toBe("2026-04-24T12:00:00Z");
  });

  it("GUARD: throws quando scaffold + env='production'", async () => {
    const scaffold = allArchetypes[0]!;
    const spec = proposeCardSpec(signal, scaffold, 1);
    const image = await new MockCardImageProvider().generateImage(spec);
    expect(() =>
      emitCard({
        spec,
        approved_at: "2026-04-24T11:00:00Z",
        emitted_at: "2026-04-24T12:00:00Z",
        image,
        secret: SECRET,
        env: "production",
      }),
    ).toThrow(/scaffold/);
  });

  it("GUARD: throws quando scaffold + env='development'", async () => {
    const scaffold = allArchetypes[0]!;
    const spec = proposeCardSpec(signal, scaffold, 1);
    const image = await new MockCardImageProvider().generateImage(spec);
    expect(() =>
      emitCard({
        spec,
        approved_at: "x",
        emitted_at: "y",
        image,
        secret: SECRET,
        env: "development",
      }),
    ).toThrow(/scaffold/);
  });

  it("archetype NÃO-scaffold emite em qualquer env", async () => {
    const spec = proposeCardSpec(signal, nonScaffoldArchetype, 42);
    const image = await new MockCardImageProvider().generateImage(spec);
    const card = emitCard({
      spec,
      approved_at: "2026-04-24T11:00:00Z",
      emitted_at: "2026-04-24T12:00:00Z",
      image,
      secret: SECRET,
      env: "production",
    });
    expect(card.card_id).toBeTruthy();
    expect(card.back.serial_number).toBe("#ryo-042");
  });

  it("signature é verificável com o secret", async () => {
    const spec = proposeCardSpec(signal, nonScaffoldArchetype, 1);
    const image = await new MockCardImageProvider().generateImage(spec);
    const card = emitCard({
      spec,
      approved_at: "2026-04-24T11:00:00Z",
      emitted_at: "2026-04-24T12:00:00Z",
      image,
      secret: SECRET,
      env: "production",
    });
    expect(
      verifyCardSignature({
        card_id: card.card_id,
        child_id: card.child_id,
        issued_at: card.issued_at,
        secret: SECRET,
        signature: card.signature,
      }),
    ).toBe(true);
  });

  it("3 marcas temporais distintas: issued < approved < emitted", async () => {
    const spec = proposeCardSpec(
      { ...signal, timestamp: "2026-04-24T10:00:00Z" },
      nonScaffoldArchetype,
      1,
    );
    const image = await new MockCardImageProvider().generateImage(spec);
    const card = emitCard({
      spec,
      approved_at: "2026-04-24T11:30:00Z",
      emitted_at: "2026-04-25T08:00:00Z",
      image,
      secret: SECRET,
      env: "test",
    });
    expect(new Date(card.issued_at).getTime()).toBeLessThan(
      new Date(card.approved_at).getTime(),
    );
    expect(new Date(card.approved_at).getTime()).toBeLessThan(
      new Date(card.emitted_at).getTime(),
    );
  });
});
