import { describe, it, expect } from "vitest";
import { sanitizeMaterialization } from "../src/select.js";

describe("sanitizeMaterialization — word boundaries", () => {
  it("does not cut partial words that contain a forbidden substring", () => {
    const result = sanitizeMaterialization("o bot se adapta");
    expect(result).toBe("o bot se adapta");
  });

  it("removes exact forbidden word and collapses spaces", () => {
    const result = sanitizeMaterialization("isso é um playbook bom");
    expect(result).toBe("isso é um bom");
  });

  it("removes multiple forbidden words and collapses resulting spaces", () => {
    const result = sanitizeMaterialization("playbookId fields score alto");
    expect(result).toBe("fields alto");
  });
});
