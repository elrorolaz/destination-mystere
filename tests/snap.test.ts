// Snap clic → ville : l'index geohash (grid-index.ts) doit être EXACT —
// strictement identique à la force brute — et rapide (p95 < 2 ms).
//
// Le cluster rémois fige la découverte M1 §11.5 : à 2 km de Reims, les
// azimuts vers Bétheny (NE) et Tinqueux (SO) sont « occupés » par des
// communes voisines de 5 000–10 000 hab., les autres rattachent à Reims.

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createSnapper, snapBruteForce } from "../src/lib/geo/snap.ts";
import { destinationPoint, haversineKm } from "../src/lib/geo/haversine.ts";
import { encodeGeohash } from "../src/lib/geo/geohash.ts";
import type { CityRecord } from "../src/lib/geo/types.ts";

// --- Fabrique de données --------------------------------------------------

function makeCity(
  id: string,
  name: string,
  lat: number,
  lng: number,
  population = 10_000,
): CityRecord {
  return {
    id,
    name,
    country: "FR",
    lat,
    lng,
    population,
    hasTrainStation: true,
    geohash: encodeGeohash(lat, lng, 6),
  };
}

const REIMS = makeCity("g2964587", "Reims", 49.2583, 4.0317, 182_000);

/** PRNG déterministe (mulberry32) — même graine, même tirage. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jeu synthétique : cluster rémois + 2 000 villes aléatoires en bbox Europe. */
function buildDataset(): CityRecord[] {
  const cities: CityRecord[] = [
    REIMS,
    makeCity("g2964524", "Bétheny", 49.2956, 4.0839, 6_700), // NE de Reims
    // Position simplifiée pour le test : plein sud-ouest de Reims à ~3,5 km.
    makeCity("g2964588", "Tinqueux", 49.2359, 3.9977, 12_000),
    makeCity("g2964585", "Épernay", 49.0403, 3.9584, 22_000),
  ];
  const rand = mulberry32(42);
  for (let i = 0; i < 2_000; i++) {
    const lat = 36 + rand() * 34; // bbox lat 36–70
    const lng = -24 + rand() * 67; // bbox lng −24–43
    cities.push(
      makeCity(
        `syn-${i}`,
        `Synthétic ${i}`,
        lat,
        lng,
        5_000 + Math.floor(rand() * 200_000),
      ),
    );
  }
  return cities;
}

// --- Tests ----------------------------------------------------------------

describe("snapBruteForce (référence)", () => {
  it("échoue explicitement sur un jeu vide", () => {
    expect(() => snapBruteForce([], 10, 10)).toThrow();
  });
});

describe("createSnapper — exactitude", () => {
  const cities = buildDataset();
  const snap = createSnapper(cities);

  it("rattache un clic sur la ville à elle-même (distance ~0)", () => {
    const result = snap(REIMS.lat, REIMS.lng);
    expect(result.city.id).toBe(REIMS.id);
    expect(result.distanceKm).toBeCloseTo(0, 3);
  });

  it("azimuts dégagés à 2 km de Reims → Reims (§11.5)", () => {
    for (const bearing of [90, 135, 180, 270, 315]) {
      const click = destinationPoint(REIMS.lat, REIMS.lng, 2, bearing);
      const result = snap(click.lat, click.lng);
      expect(result.city.name).toBe("Reims");
      expect(result.distanceKm).toBeLessThan(2.5);
    }
  });

  it("azimut occupé : un clic plein sud-ouest rattache à Tinqueux (§11.5)", () => {
    const click = destinationPoint(REIMS.lat, REIMS.lng, 2, 225);
    const result = snap(click.lat, click.lng);
    expect(result.city.name).toBe("Tinqueux");
  });

  it("rattrape un clic à distance d'une ville isolée (choix garanti)", () => {
    // Ville isolée = celle dont le voisin le plus proche est le plus loin.
    let isolated: CityRecord | null = null;
    let neighborDistance = 0;
    for (const city of cities) {
      let nearest = Infinity;
      for (const other of cities) {
        if (other.id === city.id) continue;
        const d = haversineKm(city.lat, city.lng, other.lat, other.lng);
        if (d < nearest) nearest = d;
      }
      if (nearest > neighborDistance) {
        neighborDistance = nearest;
        isolated = city;
      }
    }
    if (!isolated) throw new Error("ville isolée introuvable");

    // Clic à 45 % de la distance au voisin, dans l'azimut OPPOSÉ au
    // voisin le plus proche : aucune autre ville ne peut être plus proche
    // que la ville isolée (inég. triangulaire, cf. commentaire).
    let nearestBearing = 0;
    let nearest = Infinity;
    for (const other of cities) {
      if (other.id === isolated.id) continue;
      const d = haversineKm(isolated.lat, isolated.lng, other.lat, other.lng);
      if (d < nearest) {
        nearest = d;
        nearestBearing = bearingDeg(isolated, other);
      }
    }
    const clickDistance = nearest * 0.45;
    const click = destinationPoint(
      isolated.lat,
      isolated.lng,
      clickDistance,
      nearestBearing + 180,
    );

    const result = snap(click.lat, click.lng);
    expect(result.city.id).toBe(isolated.id);
    expect(result.distanceKm).toBeCloseTo(clickDistance, 1);
  });

  it("300 clics aléatoires : l'index renvoie EXACTEMENT la force brute", () => {
    const rand = mulberry32(1337);
    for (let i = 0; i < 300; i++) {
      const lat = 36 + rand() * 34;
      const lng = -24 + rand() * 67;
      const indexed = snap(lat, lng);
      const reference = snapBruteForce(cities, lat, lng);
      expect(indexed.city.id).toBe(reference.city.id);
      expect(indexed.distanceKm).toBeCloseTo(reference.distanceKm, 6);
    }
  });
});

describe("createSnapper — performance", () => {
  it("p95 < 2 ms par clic sur le jeu synthétique (~2 000 villes)", () => {
    const cities = buildDataset();
    const snap = createSnapper(cities);
    const rand = mulberry32(2024);

    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const lat = 36 + rand() * 34;
      const lng = -24 + rand() * 67;
      const start = performance.now();
      snap(lat, lng);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    console.log(
      `snap : médiane ${(times[150] ?? 0).toFixed(3)} ms — p95 ${p95.toFixed(3)} ms`,
    );
    expect(p95).toBeLessThan(2);
  });
});

/** Azimut initial de `from` vers `to` (0 = nord, 90 = est). */
function bearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = Math.PI / 180;
  const lat1 = from.lat * toRad;
  const lat2 = to.lat * toRad;
  const dLng = (to.lng - from.lng) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}
