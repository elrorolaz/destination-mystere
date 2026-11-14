// Haversine, conversions degrés→km et point_destination (génération de clics
// à distance connue pour les tests de snap).

import { describe, expect, it } from "vitest";
import {
  destinationPoint,
  haversineKm,
  kmPerDegreeLat,
  kmPerDegreeLng,
} from "../src/lib/geo/haversine.ts";

describe("haversineKm", () => {
  it("Paris → Reims ≈ 130 km", () => {
    expect(
      haversineKm(48.8566, 2.3522, 49.2583, 4.0317),
    ).toBeCloseTo(130.5, 0);
  });

  it("Paris → Vienne ≈ 1035 km", () => {
    expect(
      haversineKm(48.8566, 2.3522, 48.2082, 16.3738),
    ).toBeCloseTo(1035, -1);
  });

  it("distance nulle à soi-même, symétrie et signe de la longitude", () => {
    expect(haversineKm(10, 20, 10, 20)).toBeCloseTo(0, 6);
    const d1 = haversineKm(10, 20, 12, 24);
    const d2 = haversineKm(12, 24, 10, 20);
    expect(d1).toBeCloseTo(d2, 6);
    expect(haversineKm(0, -170, 0, 170)).toBeCloseTo(
      haversineKm(0, 170, 0, -170),
      6,
    );
  });

  it("demi-tour du globe : 180° d'écart à l'équateur ≈ 20 015 km", () => {
    expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(20015, -2);
  });
});

describe("conversions degrés → kilomètres", () => {
  it("1° de latitude ≈ 110,574 km", () => {
    expect(kmPerDegreeLat()).toBeCloseTo(110.574, 3);
  });

  it("1° de longitude ≈ 111,32 km à l'équateur, ~73 km à Paris", () => {
    expect(kmPerDegreeLng(1)).toBeCloseTo(111.32, 2);
    expect(kmPerDegreeLng(Math.cos((48.85 * Math.PI) / 180))).toBeCloseTo(73.4, 0);
  });

  it("retourne un minorant (0) pour |lat| > 90", () => {
    expect(kmPerDegreeLng(-0.5)).toBeCloseTo(0, 6);
  });
});

describe("destinationPoint", () => {
  it("un azimut plein nord augmente la latitude, longitude inchangée", () => {
    const { lat, lng } = destinationPoint(10, 20, 50, 0);
    expect(lat).toBeGreaterThan(10);
    expect(lng).toBeCloseTo(20, 3);
  });

  it("la distance demandée est respectée (aller-retour ≈ exact)", () => {
    const start = { lat: 48.8566, lng: 2.3522 };
    const away = destinationPoint(start.lat, start.lng, 37.5, 118);
    const measured = haversineKm(start.lat, start.lng, away.lat, away.lng);
    expect(measured).toBeCloseTo(37.5, 3);
    // L'azimut de retour n'est pas exactement antipodique sur une sphère
    // (convergence des méridiens) : on retombe à moins de 500 m du départ.
    const back = destinationPoint(away.lat, away.lng, 37.5, 298);
    expect(haversineKm(start.lat, start.lng, back.lat, back.lng)).toBeLessThan(0.5);
  });

  it("azimut plein est depuis l'équateur : longitude +0,324°", () => {
    const { lat, lng } = destinationPoint(0, 10, 36, 90);
    expect(lat).toBeCloseTo(0, 6);
    expect(haversineKm(0, 10, lat, lng)).toBeCloseTo(36, 3);
  });
});
