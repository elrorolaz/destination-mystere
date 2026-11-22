// Sélection déterministe du duo de villes (spécification §6.2) — M2.
// selectCityPair est pure : testée avec un jeu de villes synthétique.

import { describe, expect, it } from "vitest";
import { haversineKm } from "../src/lib/geo/haversine.ts";
import type { CityRecord } from "../src/lib/geo/types.ts";
import {
  MAX_KM_EU,
  MAX_KM_EU_TRAIN,
  MAX_KM_FR,
  MIN_KM_EU_AIR,
  MIN_KM_EU_TRAIN,
  MIN_KM_FR,
  NO_AIR_PROBABILITY,
  selectCityPair,
} from "../src/server/daily-challenge.ts";

function city(
  id: string,
  name: string,
  country: string,
  lat: number,
  lng: number,
  population: number,
  hasTrainStation: boolean,
): CityRecord {
  return { id, name, country, lat, lng, population, hasTrainStation, geohash: "u0" + id };
}

// Origines françaises avec gare + destinations FR et Europe.
const cities: CityRecord[] = [
  city("o1", "Reims", "FR", 49.2583, 4.0317, 180000, true),
  city("o2", "Lyon", "FR", 45.764, 4.8357, 520000, true),
  city("o3", "Lille", "FR", 50.6292, 3.0573, 230000, true),
  city("o4", "Nantes", "FR", 47.2184, -1.5536, 320000, true),
  city("o5", "Bordeaux", "FR", 44.8378, -0.5792, 260000, true),
  city("dfr1", "Marseille", "FR", 43.2965, 5.3698, 870000, true),
  city("dfr2", "Toulouse", "FR", 43.6047, 1.4442, 490000, true),
  city("dfr3", "Strasbourg", "FR", 48.5734, 7.7521, 290000, true),
  city("dfr4", "Rennes", "FR", 48.1173, -1.6778, 220000, true),
  city("deu1", "Vienne", "AT", 48.2082, 16.3738, 1900000, true),
  city("deu2", "Munich", "DE", 48.1351, 11.582, 1480000, true),
  city("deu3", "Istanbul", "TR", 41.0082, 28.9784, 15800000, false),
  city("deu4", "Barcelone", "ES", 41.3851, 2.1734, 1620000, true),
  city("deu5", "Amsterdam", "NL", 52.3676, 4.9041, 870000, true),
  // Villes sans gare / petites : jamais origines, jamais destinations FR
  city("x1", "Village", "FR", 48.0, 4.0, 6000, false),
  city("x2", "Hameau", "DE", 48.5, 8.0, 8000, false),
];

describe("selectCityPair — déterminisme et contraintes", () => {
  it("même date → même duo (rejouable à l'identique, §6.2)", () => {
    const a = selectCityPair(cities, "2026-11-21");
    const b = selectCityPair(cities, "2026-11-21");
    expect(a).not.toBeNull();
    expect(a!.origin.id).toBe(b!.origin.id);
    expect(a!.dest.id).toBe(b!.dest.id);
    expect(a!.zone).toBe(b!.zone);
  });

  it("l'origine a une gare et la distance respecte les bornes de la zone", () => {
    for (let day = 1; day <= 28; day++) {
      const key = "2026-11-" + String(day).padStart(2, "0");
      const pair = selectCityPair(cities, key);
      expect(pair).not.toBeNull();
      expect(pair!.origin.hasTrainStation).toBe(true);
      expect(pair!.origin.population).toBeGreaterThanOrEqual(20000);
      const km = haversineKm(pair!.origin.lat, pair!.origin.lng, pair!.dest.lat, pair!.dest.lng);
      if (pair!.zone === "FR") {
        expect(pair!.dest.country).toBe("FR");
        expect(km).toBeGreaterThanOrEqual(MIN_KM_FR);
        expect(km).toBeLessThanOrEqual(MAX_KM_FR);
        expect(pair!.allowAir).toBe(false); // jamais de vol France → France
      } else {
        expect(pair!.dest.country).not.toBe("FR");
        expect(pair!.dest.population).toBeGreaterThanOrEqual(50000);
        if (pair!.allowAir) {
          expect(km).toBeGreaterThanOrEqual(MIN_KM_EU_AIR);
          expect(km).toBeLessThanOrEqual(MAX_KM_EU);
        } else {
          // Europe 100 % train : bornes « terrestrial »
          expect(km).toBeGreaterThanOrEqual(MIN_KM_EU_TRAIN);
          expect(km).toBeLessThanOrEqual(MAX_KM_EU_TRAIN);
        }
      }
      expect(pair!.origin.id).not.toBe(pair!.dest.id);
    }
  });

  it("40 % des tirages sont sans avion (NO_AIR_PROBABILITY)", () => {
    expect(NO_AIR_PROBABILITY).toBe(0.4);
    let noAir = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const key = "2027-" + String(Math.floor(i / 28) + 1).padStart(2, "0") + "-" + String((i % 28) + 1).padStart(2, "0");
      const pair = selectCityPair(cities, key);
      if (pair && !pair.allowAir) noAir++;
    }
    const freq = noAir / n;
    expect(freq).toBeGreaterThan(0.3);
    expect(freq).toBeLessThan(0.5);
  });

  it("forceZone / forceAllowAir : les réessais restent dans la zone et le mode tirés", () => {
    const key = "2026-11-21";
    const first = selectCityPair(cities, key, 0);
    expect(first).not.toBeNull();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const again = selectCityPair(cities, key, attempt, {
        forceZone: first!.zone,
        forceAllowAir: first!.allowAir,
      });
      expect(again).not.toBeNull();
      expect(again!.zone).toBe(first!.zone);
      expect(again!.allowAir).toBe(first!.allowAir);
    }
  });

  it("des dates différentes donnent des duos variés", () => {
    const pairs = new Set<string>();
    for (let day = 1; day <= 20; day++) {
      const p = selectCityPair(cities, "2026-12-" + String(day).padStart(2, "0"));
      if (p) pairs.add(p.origin.id + ">" + p.dest.id);
    }
    expect(pairs.size).toBeGreaterThan(3);
  });

  it("null si aucune origine avec gare", () => {
    const noStation = cities.filter((c) => !c.hasTrainStation);
    expect(selectCityPair(noStation, "2026-11-21")).toBeNull();
  });
});
