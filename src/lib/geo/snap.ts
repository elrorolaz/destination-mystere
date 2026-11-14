// Rattachement clic → ville : API publique de la géographie du jeu (§1.2).
// Le serveur snappe le clic du joueur sur la ville de plus de 5 000 habitants
// la plus proche (le jeu de données importé fait foi).

import type { CityRecord, SnapResult } from "./types.ts";
import { buildGridIndex, bruteForce } from "./grid-index.ts";
import { haversineKm } from "./haversine.ts";

export type Snapper = (lat: number, lng: number) => SnapResult;

/**
 * Construit un snappeur pour un jeu de villes donné.
 * Retourne toujours un résultat : { ville, distanceKm }.
 */
export function createSnapper(
  cities: readonly CityRecord[],
): Snapper {
  const index = buildGridIndex(cities);
  return (lat, lng) => {
    const city = index.snap(lat, lng);
    if (!city) {
      const fallback = bruteForce(cities, lat, lng);
      if (!fallback.city) {
        throw new Error("Impossible de rattacher un clic à un jeu de villes vide");
      }
      return { city: fallback.city, distanceKm: fallback.distanceKm };
    }
    return { city, distanceKm: haversineKm(lat, lng, city.lat, city.lng) };
  };
}

/** Rattachement par force brute — référence d'exactitude pour les tests. */
export function snapBruteForce(
  cities: readonly CityRecord[],
  lat: number,
  lng: number,
): SnapResult {
  const { city, distanceKm } = bruteForce(cities, lat, lng);
  if (!city) {
    throw new Error("Impossible de rattacher un clic à un jeu de villes vide");
  }
  return { city, distanceKm };
}
