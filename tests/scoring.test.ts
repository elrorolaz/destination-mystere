// Score standard (§1.3) et score de proximité (§1.3) — M3.

import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  STANDARD_SCORES,
  proximityScore,
  standardScore,
} from "../src/server/scoring.ts";

describe("standardScore", () => {
  it("donne 1000 → 250 selon le numéro de l'essai réussi", () => {
    expect(standardScore(1)).toBe(1000);
    expect(standardScore(2)).toBe(850);
    expect(standardScore(3)).toBe(700);
    expect(standardScore(4)).toBe(550);
    expect(standardScore(5)).toBe(400);
    expect(standardScore(6)).toBe(250);
    expect(STANDARD_SCORES).toHaveLength(MAX_ATTEMPTS);
  });

  it("refuse les essais hors bornes", () => {
    expect(() => standardScore(0)).toThrow();
    expect(() => standardScore(7)).toThrow();
    expect(() => standardScore(1.5)).toThrow();
  });
});

describe("proximityScore", () => {
  it("décroît de 250 (clic au but) à 0 (200 km et au-delà)", () => {
    expect(proximityScore(0)).toBe(250);
    expect(proximityScore(100)).toBe(125);
    expect(proximityScore(150)).toBe(63); // arrondi de 62,5
    expect(proximityScore(200)).toBe(0);
    expect(proximityScore(750)).toBe(0);
  });

  it("vaut 0 sur une entrée invalide ou négative", () => {
    expect(proximityScore(Number.NaN)).toBe(0);
    expect(proximityScore(-10)).toBe(0);
  });
});
