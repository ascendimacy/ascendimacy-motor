import { describe, it, expect } from "vitest";
import { MockCardImageProvider } from "../src/card-image-provider.js";
import type { CardSpec, CardArchetype } from "../src/card-catalog.js";

const archetype: CardArchetype = {
  id: "arch_test",
  name: "Test",
  narrative_template: "x",
  casel_dimension: "SA",
  gardner_channel: "linguistic",
  rarity: "common",
  is_scaffold: true,
};

const baseSpec: CardSpec = {
  archetype,
  child_id: "ryo",
  session_id: "s1",
  context_word: "curiosity",
  casel_dimension: "SA",
  gardner_channel: "linguistic",
  issued_at: "2026-04-24T10:00:00Z",
  achievement_summary: "summary",
  sequence: 1,
};

describe("MockCardImageProvider", () => {
  const provider = new MockCardImageProvider();

  it("returns data URL with image/png mime", async () => {
    const r = await provider.generateImage(baseSpec);
    expect(r.mime).toBe("image/png");
    expect(r.image_url).toMatch(/^data:image\/png;base64,/);
    expect(r.provider).toBe("mock");
  });

  it("deterministic — same spec → same URL", async () => {
    const r1 = await provider.generateImage(baseSpec);
    const r2 = await provider.generateImage(baseSpec);
    expect(r1.image_url).toBe(r2.image_url);
  });

  it("different spec → different URL fragment (hash muda)", async () => {
    const r1 = await provider.generateImage(baseSpec);
    const r2 = await provider.generateImage({ ...baseSpec, context_word: "diferente" });
    expect(r1.image_url).not.toBe(r2.image_url);
  });
});
