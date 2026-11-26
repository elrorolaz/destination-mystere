// Score standard (§1.3), score de proximité dégressif sur la DERNIÈRE
// réponse (250 × (1 − d/300), 0 au-delà de 300 km), et multiplicateurs par
// itinéraire (×1 / ×1,5 / ×2) — M3+.

import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  PROXIMITY_MAX_POINTS,
  PROXIMITY_RADIUS_KM,
  ROUTE_SCORE_MULTIPLIERS,
  STANDARD_SCORES,
  applyRouteMultiplier,
  proximityScore,
  routeScoreMultiplier,
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

describe("proximityScore — dernière réponse, multiplicateur inversement proportionnel, rayon 300 km", () => {
  it("250 × (1 − d/300) : décroît de 250 (au but) à 0 (300 km et au-delà)", () => {
    expect(PROXIMITY_RADIUS_KM).toBe(300);
    expect(PROXIMITY_MAX_POINTS).toBe(250);
    expect(PROXIMITY_MAX_POINTS).toBe(standardScore(6)); // victoire au 6ᵉ essai
    expect(proximityScore(0)).toBe(250);
    expect(proximityScore(40)).toBe(217); // arrondi de 250 × (1 − 40/300) = 216,67
    expect(proximityScore(100)).toBe(167); // arrondi de 166,67
    expect(proximityScore(150)).toBe(125);
    expect(proximityScore(299)).toBe(1); // arrondi de 0,833
    expect(proximityScore(300)).toBe(0); // 0 si la distance dépasse 300 km
    expect(proximityScore(301)).toBe(0);
    expect(proximityScore(750)).toBe(0);
  });

  it("ne dépasse jamais la valeur d'une victoire au dernier essai (250)", () => {
    // Le multiplicateur (1 − d/300) est ≤ 1 : être proche ne rapporte jamais
    // plus que trouver la ville au 6ᵉ essai.
    for (const d of [0, 1, 40, 100, 150, 299]) {
      expect(proximityScore(d)).toBeLessThanOrEqual(standardScore(6));
    }
  });

  it("vaut 0 sur une entrée invalide ou négative", () => {
    expect(proximityScore(Number.NaN)).toBe(0);
    expect(proximityScore(-10)).toBe(0);
    expect(proximityScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("multiplicateurs par itinéraire (difficulté croissante)", () => {
  it("×1 pour le 1er, ×1,5 pour le 2e, ×2 pour le 3e", () => {
    expect(ROUTE_SCORE_MULTIPLIERS).toEqual([1, 1.5, 2]);
    expect(routeScoreMultiplier(1)).toBe(1);
    expect(routeScoreMultiplier(2)).toBe(1.5);
    expect(routeScoreMultiplier(3)).toBe(2);
  });

  it("borne les index hors plage (×1 avant 1, ×2 au-delà)", () => {
    expect(routeScoreMultiplier(0)).toBe(1);
    expect(routeScoreMultiplier(99)).toBe(2);
    expect(routeScoreMultiplier(1.7)).toBe(1);
  });

  it("applyRouteMultiplier arrondit le score × multiplicateur", () => {
    expect(applyRouteMultiplier(1000, 1)).toBe(1000);
    expect(applyRouteMultiplier(850, 2)).toBe(1275);
    expect(applyRouteMultiplier(250, 2)).toBe(375);
    expect(applyRouteMultiplier(700, 3)).toBe(1400);
    expect(applyRouteMultiplier(563, 1)).toBe(563);
    expect(applyRouteMultiplier(0, 1)).toBe(0);
    expect(applyRouteMultiplier(-5, 1)).toBe(0);
  });
});
