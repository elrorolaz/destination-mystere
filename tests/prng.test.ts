// PRNG seedé par date (spécification §6.2) — M2.

import { describe, expect, it } from "vitest";
import { fnv1a32, mulberry32, prngFromDateKey, pick, randInt } from "../src/server/prng.ts";

describe("fnv1a32 / mulberry32", () => {
  it("est déterministe", () => {
    expect(fnv1a32("2026-11-21")).toBe(fnv1a32("2026-11-21"));
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produit des valeurs dans [0, 1[", () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("deux dates différentes donnent des séquences différentes", () => {
    const a = prngFromDateKey("2026-11-21");
    const b = prngFromDateKey("2026-11-22");
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });
});

describe("randInt / pick", () => {
  it("randInt reste dans les bornes", () => {
    const rng = prngFromDateKey("2026-01-01");
    for (let i = 0; i < 500; i++) {
      const v = randInt(rng, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("pick renvoie un élément du tableau, null si vide", () => {
    const rng = prngFromDateKey("2026-01-02");
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(arr).toContain(pick(rng, arr));
    expect(pick(rng, [])).toBeNull();
  });
});
