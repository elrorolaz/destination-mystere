// Geohash — validé contre les ancres publiques (article Wikipédia « Geohash ») :
//   encodeGeohash(42.605, -5.603, 5) === "ezs42"
//   bornes de "ezs42" : lat [42.583, 42.627], lng [-5.625, -5.581]

import { describe, expect, it } from "vitest";
import {
  cellMetrics,
  decodeGeohashBounds,
  encodeGeohash,
} from "../src/lib/geo/geohash.ts";

describe("encodeGeohash", () => {
  it("reproduit l'ancre Wikipédia ezs42", () => {
    expect(encodeGeohash(42.605, -5.603, 5)).toBe("ezs42");
  });

  it("encode la tour Eiffel en précision 4", () => {
    // Ancre de sens commun : u09t est le préfixe Paris-centre.
    expect(encodeGeohash(48.8584, 2.2945, 4)).toBe("u09t");
  });

  it("est préfixe-stable : précision p+1 prolonge précision p", () => {
    const short = encodeGeohash(51.5074, -0.1278, 4);
    const long = encodeGeohash(51.5074, -0.1278, 7);
    expect(long.startsWith(short)).toBe(true);
  });

  it("gère les pôles et l'antiméridien sans planter", () => {
    expect(() => encodeGeohash(90, 180, 5)).not.toThrow();
    expect(() => encodeGeohash(-90, -180, 5)).not.toThrow();
  });
});

describe("decodeGeohashBounds", () => {
  it("retrouve les bornes publiées pour ezs42", () => {
    const bounds = decodeGeohashBounds("ezs42");
    expect(bounds.latMin).toBeCloseTo(42.583, 2);
    expect(bounds.latMax).toBeCloseTo(42.627, 2);
    expect(bounds.lngMin).toBeCloseTo(-5.625, 2);
    expect(bounds.lngMax).toBeCloseTo(-5.581, 2);
  });

  it("toute précision englobe le point encodé", () => {
    for (const [lat, lng] of [
      [48.8566, 2.3522],
      [41.3874, 2.1686],
      [59.3293, 18.0686],
    ]) {
      const hash = encodeGeohash(lat, lng, 6);
      const bounds = decodeGeohashBounds(hash);
      expect(lat).toBeGreaterThanOrEqual(bounds.latMin);
      expect(lat).toBeLessThanOrEqual(bounds.latMax);
      expect(lng).toBeGreaterThanOrEqual(bounds.lngMin);
      expect(lng).toBeLessThanOrEqual(bounds.lngMax);
    }
  });

  it("rejette les caractères hors Base32", () => {
    expect(() => decodeGeohashBounds("eas42")).toThrow();
  });
});

describe("cellMetrics", () => {
  it("mesure une cellule de précision 4 autour de Paris (~26 × 19,5 km)", () => {
    const { widthKm, heightKm } = cellMetrics("u09t");
    expect(heightKm).toBeCloseTo(19.5, 0);
    expect(widthKm).toBeCloseTo(25.7, 0);
  });

  it("les cellules rétrécissent avec la précision", () => {
    const p4 = cellMetrics("u09t");
    const p6 = cellMetrics(encodeGeohash(48.8566, 2.3522, 6));
    expect(p6.widthKm).toBeLessThan(p4.widthKm);
    expect(p6.heightKm).toBeLessThan(p4.heightKm);
  });
});
