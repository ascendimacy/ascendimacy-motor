import { describe, it, expect, afterEach } from "vitest";
import { getNow, resolveDbPath } from "../src/clock.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  delete process.env["STS_VIRTUAL_NOW"];
  delete process.env["MOTOR_STATE_DIR"];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("getNow — virtual clock resolution", () => {
  it("uses explicit argument over env", () => {
    process.env["STS_VIRTUAL_NOW"] = "2000-01-01T00:00:00Z";
    expect(getNow("2030-06-15T12:00:00Z")).toBe("2030-06-15T12:00:00Z");
  });

  it("uses env STS_VIRTUAL_NOW when no explicit arg", () => {
    process.env["STS_VIRTUAL_NOW"] = "2026-05-15T10:00:00Z";
    expect(getNow()).toBe("2026-05-15T10:00:00Z");
  });

  it("falls back to real clock when neither explicit nor env", () => {
    delete process.env["STS_VIRTUAL_NOW"];
    const result = getNow();
    // Format is ISO, parseable
    expect(new Date(result).toString()).not.toBe("Invalid Date");
  });

  it("empty env string treated as missing", () => {
    process.env["STS_VIRTUAL_NOW"] = "";
    const result = getNow();
    expect(new Date(result).toString()).not.toBe("Invalid Date");
  });
});

describe("resolveDbPath — MOTOR_STATE_DIR env", () => {
  it("uses explicit override when provided", () => {
    process.env["MOTOR_STATE_DIR"] = "/tmp/ignored";
    expect(resolveDbPath("/default", "/explicit.db")).toBe("/explicit.db");
  });

  it("uses env MOTOR_STATE_DIR when no explicit override", () => {
    process.env["MOTOR_STATE_DIR"] = "/tmp/scenario1";
    expect(resolveDbPath("/default.db")).toBe("/tmp/scenario1/.motor-state.db");
  });

  it("strips trailing slash from env dir", () => {
    process.env["MOTOR_STATE_DIR"] = "/tmp/scenario1/";
    expect(resolveDbPath("/default.db")).toBe("/tmp/scenario1/.motor-state.db");
  });

  it("falls back to defaultPath when env unset", () => {
    delete process.env["MOTOR_STATE_DIR"];
    expect(resolveDbPath("/default.db")).toBe("/default.db");
  });

  it("empty env string treated as missing", () => {
    process.env["MOTOR_STATE_DIR"] = "";
    expect(resolveDbPath("/default.db")).toBe("/default.db");
  });
});
