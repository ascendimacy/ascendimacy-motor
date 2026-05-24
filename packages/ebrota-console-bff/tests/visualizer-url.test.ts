import { describe, it, expect, vi } from "vitest";
import {
  formatVisualizerUrl,
  printVisualizerLink,
} from "../src/visualizer-url.js";

describe("formatVisualizerUrl", () => {
  it("default localhost:3737 http", () => {
    expect(formatVisualizerUrl("replay", "yuji__a")).toBe(
      "http://localhost:3737/replay/yuji__a",
    );
    expect(formatVisualizerUrl("live", "sess-x")).toBe(
      "http://localhost:3737/live/sess-x",
    );
  });

  it("override host + port + protocol", () => {
    expect(
      formatVisualizerUrl("replay", "x", {
        host: "ebrota.example.com",
        port: 443,
        protocol: "https",
      }),
    ).toBe("https://ebrota.example.com:443/replay/x");
  });

  it("encoda sessionId com chars especiais", () => {
    expect(
      formatVisualizerUrl("live", "yuji__5511aaa@s.whatsapp.net"),
    ).toBe(
      "http://localhost:3737/live/yuji__5511aaa%40s.whatsapp.net",
    );
  });
});

describe("printVisualizerLink", () => {
  it("imprime URL + warning hint no writer injetado", () => {
    const writes: string[] = [];
    const url = printVisualizerLink("replay", "sess-1", {
      write: (m) => writes.push(m),
    });
    expect(url).toBe("http://localhost:3737/replay/sess-1");
    expect(writes.join("")).toContain("→ visualizer (replay):");
    expect(writes.join("")).toContain("http://localhost:3737/replay/sess-1");
    expect(writes.join("")).toContain("se BFF não estiver rodando");
  });

  it("prefix custom aplicado em ambas as linhas", () => {
    const writes: string[] = [];
    printVisualizerLink("live", "x", {
      prefix: "[smoke] ",
      write: (m) => writes.push(m),
    });
    expect(writes[0]).toMatch(/^\[smoke\] → visualizer/);
    expect(writes[1]?.startsWith("[smoke] ")).toBe(true);
    expect(writes[1]).toContain("(se BFF");
  });

  it("default writer escreve em stderr (sem trash console.log)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(
      () => true as never,
    );
    printVisualizerLink("live", "x");
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
