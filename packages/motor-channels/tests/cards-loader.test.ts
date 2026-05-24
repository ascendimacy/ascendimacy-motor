import { describe, it, expect } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCardPackageLoader } from "../src/cards-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures/pacotes");

describe("createCardPackageLoader", () => {
  it("loads an existing card package", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const pkg = await loader.load("tabuada-7");
    expect(pkg).not.toBeNull();
    expect(pkg!.cardId).toBe("tabuada-7");
    expect(pkg!.raw).toContain("Tabuada do 7");
    expect(pkg!.sourcePath).toBe(join(FIXTURES_DIR, "tabuada-7.md"));
  });

  it("returns null for missing card (ENOENT)", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    expect(await loader.load("does-not-exist")).toBeNull();
  });

  it("rejects path-traversal cardIds without touching fs", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    expect(await loader.load("../etc/passwd")).toBeNull();
    expect(await loader.load("foo/bar")).toBeNull();
    expect(await loader.load("..")).toBeNull();
    expect(await loader.load(".")).toBeNull();
  });

  it("rejects malformed cardIds (uppercase, underscore, empty)", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    expect(await loader.load("UPPER")).toBeNull();
    expect(await loader.load("foo_bar")).toBeNull();
    expect(await loader.load("")).toBeNull();
    expect(await loader.load("foo bar")).toBeNull();
  });

  it("returns cached reference on repeated load (same identity)", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const first = await loader.load("tabuada-7");
    const second = await loader.load("tabuada-7");
    expect(second).toBe(first);
  });

  it("invalidate(cardId) drops a single entry", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const first = await loader.load("tabuada-7");
    loader.invalidate("tabuada-7");
    const reloaded = await loader.load("tabuada-7");
    expect(reloaded).not.toBeNull();
    expect(reloaded).not.toBe(first);
    expect(reloaded!.raw).toBe(first!.raw);
  });

  it("invalidate() with no arg clears the whole cache", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const a = await loader.load("tabuada-7");
    const b = await loader.load("frutas-vermelhas");
    loader.invalidate();
    const aReloaded = await loader.load("tabuada-7");
    const bReloaded = await loader.load("frutas-vermelhas");
    expect(aReloaded).not.toBe(a);
    expect(bReloaded).not.toBe(b);
  });

  it("invalidate(cardId) only drops that one (others stay cached)", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const a = await loader.load("tabuada-7");
    const b = await loader.load("frutas-vermelhas");
    loader.invalidate("tabuada-7");
    const bAgain = await loader.load("frutas-vermelhas");
    expect(bAgain).toBe(b);
    const aAgain = await loader.load("tabuada-7");
    expect(aAgain).not.toBe(a);
  });

  it("distinct cards yield distinct packages", async () => {
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const a = await loader.load("tabuada-7");
    const b = await loader.load("frutas-vermelhas");
    expect(a!.cardId).toBe("tabuada-7");
    expect(b!.cardId).toBe("frutas-vermelhas");
    expect(a!.raw).not.toBe(b!.raw);
  });
});
