import { describe, it, expect } from "vitest";
import { parseUrlParams } from "../src/lib/url-params.js";

describe("parseUrlParams — S-OC-22 smoke visualizer deep links", () => {
  it("?replay=ID retorna replaySessionId", () => {
    expect(parseUrlParams("?replay=yuji__abc")).toEqual({
      replaySessionId: "yuji__abc",
      liveSessionId: null,
    });
  });

  it("?live=ID retorna liveSessionId", () => {
    expect(parseUrlParams("?live=sess-live-1")).toEqual({
      replaySessionId: null,
      liveSessionId: "sess-live-1",
    });
  });

  it("search vazio retorna ambos null", () => {
    expect(parseUrlParams("")).toEqual({
      replaySessionId: null,
      liveSessionId: null,
    });
  });

  it("?replay= (vazio) é ignorado", () => {
    expect(parseUrlParams("?replay=")).toEqual({
      replaySessionId: null,
      liveSessionId: null,
    });
  });

  it("?replay=ID precedence sobre ?live=ID (replay wins)", () => {
    expect(parseUrlParams("?replay=r1&live=l1")).toEqual({
      replaySessionId: "r1",
      liveSessionId: null,
    });
  });

  it("decoda sessionId encoded", () => {
    expect(
      parseUrlParams("?replay=yuji__5511%40s.whatsapp.net"),
    ).toEqual({
      replaySessionId: "yuji__5511@s.whatsapp.net",
      liveSessionId: null,
    });
  });

  it("ignora outros params irrelevantes", () => {
    expect(parseUrlParams("?foo=bar&replay=x&baz=qux")).toEqual({
      replaySessionId: "x",
      liveSessionId: null,
    });
  });
});
