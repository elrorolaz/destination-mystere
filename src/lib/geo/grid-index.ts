// Index spatial par geohash (précision 4) avec scan différentiel exact.
//
// Principe : les cellules geohash de précision 4 forment une grille
// rectangulaire régulière (~39 km × 19,5 km à l'équateur). On scanne les
// anneaux de cellules autour du clic, du plus proche au plus lointain, et on
// s'arrête dès qu'aucune cellule non visitée ne peut contenir une ville plus
// proche : tout point d'une cellule à distance de Chebyshev k du centre est
// à au moins (k-1) × dimension-minimale-de-cellule du clic.
//
// La borne conservative utilise la plus petite dimension possible d'une
// cellule sur la bbox Europe (§ scripts/lib/europe.ts) : 0,351° de
// longitude à 72° de latitude ≈ 12,07 km. Le résultat est EXACT (identique
// à la force brute, cf. tests/snap.test.ts) et non une approximation.

import type { CityRecord } from "./types.ts";
import { encodeGeohash, decodeGeohashBounds } from "./geohash.ts";
import { haversineKm, kmPerDegreeLat, kmPerDegreeLng } from "./haversine.ts";

/** Précision geohash des cellules de l'index. */
const CELL_PRECISION = 4;

// Précision 4 : 5 bits par caractère, alternés longitude/latitude → 10 bits
// de longitude et 10 bits de latitude après 4 caractères.
const CELL_LNG_DEG = 360 / 2 ** 10; // ≈ 0,351°
const CELL_LAT_DEG = 180 / 2 ** 10; // ≈ 0,176°

/** Minorant de la plus petite dimension (km) d'une cellule sur la bbox Europe. */
const MIN_CELL_KM = Math.min(
  CELL_LAT_DEG * kmPerDegreeLat(),
  CELL_LNG_DEG * kmPerDegreeLng(Math.cos((72 * Math.PI) / 180)), // ≈ 12,07 km
);

/** Anneau maximal exploré avant repli sur la force brute (garantie d'exactitude). */
const MAX_RING = 64;

export interface GridIndex {
  /** Rattache un point à la ville la plus proche — résultat exact. */
  snap(lat: number, lng: number): CityRecord | null;
  /** Nombre de cellules occupées (diagnostic). */
  size(): number;
}

export function buildGridIndex(cities: readonly CityRecord[]): GridIndex {
  const cells = new Map<string, CityRecord[]>();

  for (const city of cities) {
    const key = encodeGeohash(city.lat, city.lng, CELL_PRECISION);
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(city);
    } else {
      cells.set(key, [city]);
    }
  }

  function snap(lat: number, lng: number): CityRecord | null {
    let best: CityRecord | null = null;
    let bestDistance = Infinity;

    const centerKey = encodeGeohash(lat, lng, CELL_PRECISION);
    const centerBounds = decodeGeohashBounds(centerKey);
    const cellLat = centerBounds.latMax - centerBounds.latMin;
    const cellLng = centerBounds.lngMax - centerBounds.lngMin;
    const centerLat = (centerBounds.latMin + centerBounds.latMax) / 2;
    const centerLng = (centerBounds.lngMin + centerBounds.lngMax) / 2;

    for (let ring = 0; ring <= MAX_RING; ring++) {
      // Anneaux déjà visités : 0..ring-1. Toute cellule non encore visitée
      // est à une distance de Chebyshev ≥ ring, donc à au moins
      // (ring - 1) × MIN_CELL_KM du clic (un point collé à un bord de sa
      // cellule est à (k-1) cellules de toute cellule à Chebyshev k). Si la
      // meilleure ville trouvée est plus proche que cette borne, on a fini.
      if (best && bestDistance <= (ring - 1) * MIN_CELL_KM) {
        break;
      }

      // Énumère les cellules de l'anneau `ring` (dédupe par Set).
      const seen = new Set<string>();
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nLat = centerLat + dx * cellLat;
          const nLng = centerLng + dy * cellLng;
          if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) continue;
          const key = encodeGeohash(nLat, nLng, CELL_PRECISION);
          if (seen.has(key)) continue;
          seen.add(key);

          const bucket = cells.get(key);
          if (!bucket) continue;
          for (const city of bucket) {
            const d = haversineKm(lat, lng, city.lat, city.lng);
            if (d < bestDistance) {
              bestDistance = d;
              best = city;
            }
          }
        }
      }
    }

    if (!best) {
      // Repli exact (rare : clic très loin de toute ville indexée).
      return bruteForce(cities, lat, lng).city;
    }
    return best;
  }

  return { snap, size: () => cells.size };
}

/** Force brute — référence d'exactitude pour les tests et le repli. */
export function bruteForce(
  cities: readonly CityRecord[],
  lat: number,
  lng: number,
): { city: CityRecord | null; distanceKm: number } {
  let best: CityRecord | null = null;
  let bestDistance = Infinity;
  for (const city of cities) {
    const d = haversineKm(lat, lng, city.lat, city.lng);
    if (d < bestDistance) {
      bestDistance = d;
      best = city;
    }
  }
  return { city: best, distanceKm: bestDistance };
}
