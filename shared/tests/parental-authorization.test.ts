import { describe, it, expect } from "vitest";
import {
  triageRuleBased,
  triageWithHaiku,
  triageForParents,
} from "../src/parental-authorization.js";
import type { ParentalProfile } from "../src/parental-profile.js";
import type { ContentItem, ScoredContentItem } from "../src/content-item.js";

const yuji: ParentalProfile = {
  id: "yuji",
  role: "primary",
  decision_profile: "consultative_risk_averse",
  family_values: { principles: ["esforço>resultado"] },
  forbidden_zones: [
    { topic: "political_content", reason: "divisivo" },
    { topic: "religious_proselytizing", reason: "respeito" },
  ],
  budget_constraints: { screen_time_daily_max_minutes: 90 },
  parental_availability: {
    scale_tolerance: { micro: "yes", pequeno: "yes", medio: "yes", grande: "yes_with_review" },
  },
};

function hook(id: string, score: number, overrides: Partial<ContentItem> = {}): ScoredContentItem {
  return {
    item: {
      id,
      type: "curiosity_hook",
      domain: "biology",
      casel_target: ["SA"],
      age_range: [7, 14],
      surprise: 8,
      verified: true,
      base_score: 7,
      fact: "",
      bridge: "",
      quest: "",
      sacrifice_type: "reflect",
      ...overrides,
    } as ContentItem,
    score,
    reasons: [],
  };
}

describe("triageRuleBased — forbidden zones", () => {
  it("rejects item whose domain matches forbidden topic", () => {
    const pool = [
      hook("pol1", 9, { domain: "political", fact: "algo sobre eleição" }),
      hook("bio1", 8, { domain: "biology" }),
    ];
    const r = triageRuleBased({ pool, profile: yuji, max_approved: 2 });
    const approvedIds = r.approved.map((s) => s.item.id);
    expect(approvedIds).toContain("bio1");
    expect(approvedIds).not.toContain("pol1");
    expect(r.rejected.find((x) => x.item.id === "pol1")?.reject_reason).toMatch(/political/);
  });

  it("rejects item whose fact contains forbidden topic substring", () => {
    const pool = [
      hook("h1", 9, { fact: "religious_proselytizing em países secularizados" }),
    ];
    const r = triageRuleBased({ pool, profile: yuji });
    expect(r.approved).toHaveLength(0);
  });

  it("approves all when no forbidden zones match", () => {
    const pool = [hook("bio1", 9), hook("bio2", 7)];
    const r = triageRuleBased({ pool, profile: yuji });
    expect(r.approved).toHaveLength(2);
  });

  it("trims pool to max_approved after approving", () => {
    const pool = [hook("a", 9), hook("b", 8), hook("c", 7)];
    const r = triageRuleBased({ pool, profile: yuji, max_approved: 2 });
    expect(r.approved).toHaveLength(2);
    expect(r.approved.map((s) => s.item.id)).toEqual(["a", "b"]);
    expect(r.rejected.find((x) => x.item.id === "c")?.reject_reason).toBe("below_max_approved_cutoff");
  });
});

describe("triageRuleBased — scale tolerance", () => {
  it("blocks act/create when scale_tolerance says no", () => {
    const restrictive: ParentalProfile = {
      ...yuji,
      parental_availability: {
        scale_tolerance: { medio: "no", pequeno: "yes", micro: "yes" },
      },
    };
    const pool = [hook("act1", 9, { sacrifice_type: "act" })];
    const r = triageRuleBased({ pool, profile: restrictive });
    expect(r.approved).toHaveLength(0);
    expect(r.rejected[0]!.reject_reason).toBe("scale_tolerance_blocks_act_or_create");
  });
});

describe("triageWithHaiku — rerank + fallback", () => {
  it("calls Haiku and reorders according to response", async () => {
    const pool = [hook("a", 5), hook("b", 9), hook("c", 7)];
    const mockHaiku = async () => JSON.stringify({ ranking: ["c", "a"] });
    const r = await triageWithHaiku({ pool, profile: yuji, max_approved: 2 }, mockHaiku);
    expect(r.triage_mode).toBe("haiku");
    expect(r.approved.map((s) => s.item.id)).toEqual(["c", "a"]);
    // 'b' omitido pelo Haiku vira rejected
    expect(r.rejected.find((x) => x.item.id === "b")?.reject_reason).toBe("haiku_omitted");
  });

  it("falls back to rule_based when Haiku throws", async () => {
    const pool = [hook("a", 5), hook("b", 9)];
    const broken = async () => {
      throw new Error("timeout");
    };
    const r = await triageWithHaiku({ pool, profile: yuji }, broken);
    expect(r.triage_mode).toBe("rule_based");
    expect(r.approved.length).toBeGreaterThan(0);
  });

  it("falls back when Haiku returns unparseable", async () => {
    const pool = [hook("a", 9)];
    const malformed = async () => "not json at all";
    const r = await triageWithHaiku({ pool, profile: yuji }, malformed);
    expect(r.triage_mode).toBe("rule_based");
  });
});

describe("triageForParents — dispatch", () => {
  it("uses rule_based when no Haiku caller", async () => {
    const pool = [hook("a", 9)];
    const r = await triageForParents({ pool, profile: yuji });
    expect(r.triage_mode).toBe("rule_based");
  });

  it("uses Haiku when caller provided", async () => {
    const pool = [hook("a", 9)];
    const r = await triageForParents(
      { pool, profile: yuji },
      async () => JSON.stringify({ ranking: ["a"] }),
    );
    expect(r.triage_mode).toBe("haiku");
  });
});
