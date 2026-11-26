// Jeu de villes en mémoire pour le snap serveur (§1.2) : chargé une seule
// fois par process (M1 a validé l'index geohash exact, ~0,03 ms médian).
//
// Design « clusters d'agglomérations » : chaque ville est rattachée à la ville
// la plus peuplée dans un rayon de 15 km (elle-même incluse) — seules les
// villes de référence sont affichées sur la carte et cliquables : le snap
// aboutit toujours sur la référence du cluster (un clic à Boulogne-Billancourt
// propose « Paris »).

import { db } from "../lib/db.ts";
import type { CityRecord } from "../lib/geo/types.ts";
import { createSnapper, type Snapper } from "../lib/geo/snap.ts";
import { haversineKm } from "../lib/geo/haversine.ts";
import { buildClusterIndex, type ClusterIndex } from "../lib/geo/clusters.ts";

interface CityCache {
  cities: CityRecord[];
  snapper: Snapper;
  clusters: ClusterIndex;
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
  const clusters = buildClusterIndex(rows);
  console.info(
    `Clusters (15 km) : ${rows.length} villes → ${clusters.refCount()} références affichées/cliquables.`,
  );
  const base = createSnapper(rows);
  // Le snap aboutit sur la ville de référence du cluster (seule cliquable).
  const snapper: Snapper = (lat, lng) => {
    const r = base(lat, lng);
    const ref = clusters.refCity(r.city);
    return { city: ref, distanceKm: haversineKm(lat, lng, ref.lat, ref.lng) };
  };
  return { cities: rows, snapper, clusters };
}

/** Charge (ou réutilise) le jeu de villes, le snappeur et l'index de clusters. */
export function getCitiesCache(): Promise<CityCache | null> {
  cachePromise ??= loadCities();
  return cachePromise;
}

/** Snappeur serveur : clic → ville de référence du cluster le plus proche. */
export async function getSnapper(): Promise<Snapper> {
  const cache = await getCitiesCache();
  if (!cache) {
    throw new Error("Base de villes vide : npm run prepare:cities && npm run data:import");
  }
  return cache.snapper;
}

// Snappeurs filtrés par seuil de population (cache par seuil) : pendant une
// manche, seules les villes « possibles » (population ≥ seuil de la
// destination de l'itinéraire courant) sont cliquables — un clic est rattaché
// à la ville la plus proche PARMI LES VILLES AUTORISÉES.
const snappersByFloor = new Map<number, Snapper>();

/**
 * Snappeur restreint aux villes de population ≥ `minPopulation` : seules ces
 * villes sont « cliquables » (le snap aboutit sur la référence de cluster de la
 * ville autorisée la plus proche — la référence d'un cluster est toujours au
 * moins aussi peuplée que la ville elle-même, donc elle reste autorisée).
 */
export async function getSnapperForFloor(minPopulation: number): Promise<Snapper> {
  const cache = await getCitiesCache();
  if (!cache) {
    throw new Error("Base de villes vide : npm run prepare:cities && npm run data:import");
  }
  const cached = snappersByFloor.get(minPopulation);
  if (cached) return cached;
  const allowed = cache.cities.filter((c) => c.population >= minPopulation);
  const base = createSnapper(allowed.length > 0 ? allowed : cache.cities);
  const snapper: Snapper = (lat, lng) => {
    const r = base(lat, lng);
    const ref = cache.clusters.refCity(r.city);
    return { city: ref, distanceKm: haversineKm(lat, lng, ref.lat, ref.lng) };
  };
  snappersByFloor.set(minPopulation, snapper);
  return snapper;
}

/** Index des clusters (références affichées/cliquables) — pour /api/cities et le tirage du défi. */
export async function getClusterIndex(): Promise<ClusterIndex> {
  const cache = await getCitiesCache();
  if (!cache) {
    throw new Error("Base de villes vide : npm run prepare:cities && npm run data:import");
  }
  return cache.clusters;
}
