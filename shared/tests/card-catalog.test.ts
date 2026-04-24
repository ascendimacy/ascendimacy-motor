import { describe, it, expect } from "vitest";
import {
  formatSerialNumber,
  gardnerIcon,
  GARDNER_CHANNEL_ICON,
  CARD_BACK_TEMPLATES,
} from "../src/card-catalog.js";

describe("formatSerialNumber", () => {
  it("pads sequence to 3 digits", () => {
    expect(formatSerialNumber("ryo", 1)).toBe("#ryo-001");
    expect(formatSerialNumber("ryo", 42)).toBe("#ryo-042");
    expect(formatSerialNumber("ryo", 137)).toBe("#ryo-137");
  });
  it("does not truncate sequence > 999", () => {
    expect(formatSerialNumber("ryo", 1234)).toBe("#ryo-1234");
  });
});

describe("gardnerIcon", () => {
  it("maps all 9 channels", () => {
    expect(Object.keys(GARDNER_CHANNEL_ICON)).toHaveLength(9);
    expect(gardnerIcon("linguistic")).toBe("✍️");
    expect(gardnerIcon("logical_mathematical")).toBe("💡");
    expect(gardnerIcon("existential")).toBe("🌌");
  });
});

describe("CARD_BACK_TEMPLATES", () => {
  it("v1 has exactly one template", () => {
    expect(CARD_BACK_TEMPLATES).toEqual(["v1-default"]);
  });
});
