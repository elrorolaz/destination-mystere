// Jeu de villes en mémoire pour le snap serveur (§1.2) : chargé une seule
// fois par process (M1 a validé l'index geohash exact, ~0,03 ms médian).

import { db } from "../lib/db.ts";
import type { CityRecord } from "../lib/geo/types.ts";
import { createSnapper, type Snapper } from "../lib/geo/snap.ts";

interface CityCache {
  cities: CityRecord[];
  snapper: Snapper;
}

let cachePromise: Promise<CityCache | null> | null = null;

async function loadCities(): Promise<CityCache | null> {
  const rows = await db.city.findMany({
    select: {
      id: true,
      name: true,
      country: true,
      lat: true,
      lng: true,
      population: true,
      hasTrainStation: true,
      geohash: true,
    },
  });
  if (rows.length === 0) {
    console.error(
      "Aucune ville en base : lancer npm run prepare:cities puis npm run data:import.",
    );
    return null;
  }
  return { cities: rows, snapper: createSnapper(rows) };
}

/** Charge (ou réutilise) le jeu de villes et le snappeur du process. */
export function getCitiesCache(): Promise<CityCache | null> {
  cachePromise ??= loadCities();
  return cachePromise;
}

/** Snappeur serveur : clic → ville > 5 000 habitants la plus proche. */
export async function getSnapper(): Promise<Snapper> {
  const cache = await getCitiesCache();
  if (!cache) {
    throw new Error("Base de villes vide : npm run prepare:cities && npm run data:import");
  }
  return cache.snapper;
}
