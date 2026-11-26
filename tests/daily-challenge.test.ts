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
  minPopulationForSlot,
  selectCityPair,
  SLOT_MIN_POPULATION,
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
  // Villes sans gare / petites : jamais origines (sans gare), et filtrées
  // comme destinations selon le seuil de difficulté.
  city("x1", "Village", "FR", 48.0, 4.0, 6000, false),
  city("x2", "Hameau", "DE", 48.5, 8.0, 8000, false),
  // Petite ville AVEC gare : origine éligible à TOUS les slots (le seuil de
  // difficulté ne porte que sur la destination), jamais destination au slot 1.
  city("x3", "Petite-Ville", "FR", 48.95, 4.5, 9000, true),
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
      // Slot 1 : villes majeures uniquement (≥ 50 000 hab.) — au BUT seulement.
      const pair = selectCityPair(cities, key, 0, { minPopulation: minPopulationForSlot(1) });
      expect(pair).not.toBeNull();
      expect(pair!.origin.country).toBe("FR");
      expect(pair!.origin.hasTrainStation).toBe(true);
      expect(pair!.dest.population).toBeGreaterThanOrEqual(50000);
      const km = haversineKm(pair!.origin.lat, pair!.origin.lng, pair!.dest.lat, pair!.dest.lng);
      if (pair!.zone === "FR") {
        expect(pair!.dest.country).toBe("FR");
        expect(km).toBeGreaterThanOrEqual(MIN_KM_FR);
        expect(km).toBeLessThanOrEqual(MAX_KM_FR);
        expect(pair!.allowAir).toBe(false); // jamais de vol France → France
      } else {
        expect(pair!.dest.country).not.toBe("FR");
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

  it("exclude : une paire déjà prise par un autre itinéraire du jour n'est jamais re-tirée", () => {
    const key = "2026-11-21";
    const first = selectCityPair(cities, key, 0);
    expect(first).not.toBeNull();
    const excluded = new Set([first!.origin.id + ">" + first!.dest.id]);
    const taken = first!.origin.id + ">" + first!.dest.id;
    for (let attempt = 0; attempt < 25; attempt++) {
      const p = selectCityPair(cities, key, attempt, { exclude: excluded });
      if (p) expect(p.origin.id + ">" + p.dest.id).not.toBe(taken);
    }
  });

  it("les graines par slot (date#rN) produisent des tirages déterministes et variés", () => {
    // Même seed → même duo ; seeds de slots différents → tirages indépendants.
    const a1 = selectCityPair(cities, "2026-11-21#r2", 0);
    const a2 = selectCityPair(cities, "2026-11-21#r2", 0);
    expect(a1).not.toBeNull();
    expect(a1!.origin.id).toBe(a2!.origin.id);
    expect(a1!.dest.id).toBe(a2!.dest.id);

    // Sur 30 dates, les 3 slots (avec exclude alimenté au fur et à mesure)
    // ne se répètent jamais dans une même journée.
    let distinctDays = 0;
    for (let day = 1; day <= 30; day++) {
      const key = "2026-12-" + String(day).padStart(2, "0");
      const seen = new Set<string>();
      let ok = true;
      for (const seed of [key, key + "#r2", key + "#r3"]) {
        const p = selectCityPair(cities, seed, 0, { exclude: seen });
        if (!p) continue;
        const pairKey = p.origin.id + ">" + p.dest.id;
        if (seen.has(pairKey)) ok = false;
        seen.add(pairKey);
      }
      if (ok) distinctDays++;
    }
    expect(distinctDays).toBe(30);
  });
});

describe("échelonnement de la difficulté sur les 3 itinéraires", () => {
  it("minPopulationForSlot : 50 000 / 20 000 / 0 (toutes les villes) pour les slots 1/2/3", () => {
    expect(SLOT_MIN_POPULATION).toEqual([50000, 20000, 0]);
    expect(minPopulationForSlot(1)).toBe(50000);
    expect(minPopulationForSlot(2)).toBe(20000);
    expect(minPopulationForSlot(3)).toBe(0);
    // borné hors plage
    expect(minPopulationForSlot(0)).toBe(50000);
    expect(minPopulationForSlot(99)).toBe(0);
  });

  it("slot 1 (minPopulation 50 000) : jamais de petite ville comme DESTINATION", () => {
    for (let day = 1; day <= 40; day++) {
      const key = "2027-01-" + String(day).padStart(2, "0");
      for (const seed of [key, key + "#r2", key + "#r3"]) {
        const p = selectCityPair(cities, seed, 0, { minPopulation: minPopulationForSlot(1) });
        if (!p) continue;
        expect(p.dest.population).toBeGreaterThanOrEqual(50000);
        expect(p.dest.id).not.toBe("x1");
        expect(p.dest.id).not.toBe("x2");
      }
    }
  });

  it("le seuil ne s'applique PAS au départ : une petite ville avec gare peut être origine même au slot 1", () => {
    // x3 = Petite-Ville, 9 000 hab., gare : éligible comme départ à tous les
    // slots, alors que la destination reste ≥ 50 000 hab.
    let sawSmallOrigin = false;
    for (let day = 1; day <= 60 && !sawSmallOrigin; day++) {
      const key = "2027-04-" + String(day).padStart(2, "0");
      for (const seed of [key, key + "#r2", key + "#r3"]) {
        const p = selectCityPair(cities, seed, 0, { minPopulation: minPopulationForSlot(1) });
        if (!p) continue;
        expect(p.dest.population).toBeGreaterThanOrEqual(50000); // but toujours majeur
        if (p.origin.population < 50000) sawSmallOrigin = true;
      }
    }
    expect(sawSmallOrigin).toBe(true);
  });

  it("slot 2 (20 000) : le hameau de 8 000 hab. (x2) n'est jamais destination", () => {
    for (let day = 1; day <= 40; day++) {
      const key = "2027-02-" + String(day).padStart(2, "0");
      const p = selectCityPair(cities, key, 0, { minPopulation: minPopulationForSlot(2) });
      if (!p) continue;
      expect(p.dest.id).not.toBe("x2");
      expect(p.dest.population).toBeGreaterThanOrEqual(20000);
    }
  });

  it("slot 3 (0) : toutes les villes du corpus sont éligibles comme destination (x1/x2 peuvent tomber)", () => {
    let sawSmall = false;
    for (let day = 1; day <= 60 && !sawSmall; day++) {
      const key = "2027-03-" + String(day).padStart(2, "0");
      const p = selectCityPair(cities, key, 0, { minPopulation: minPopulationForSlot(3) });
      if (p && p.dest.population < 20000) sawSmall = true;
    }
    expect(sawSmall).toBe(true);
  });
});
