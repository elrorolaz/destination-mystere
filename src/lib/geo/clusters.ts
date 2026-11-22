// Clusters d'agglomérations (design) : chaque ville est associée à la ville
// la PLUS PEUPLÉE dans un rayon de 15 km autour d'elle (elle-même incluse) ;
// si c'est elle-même, elle devient le point de référence du cluster. Seule la
// ville référence est affichée sur la carte et cliquable (le snap y aboutit).
//
// La règle est appliquée jusqu'au point fixe (ref(V) = ref(ref(V))), ce qui
// regroupe toute une agglomération sur sa ville centre même en chaîne
// (A → B → C : A et B visent C). La relation « plus peuplée, à population
// égale le plus petit id » étant strictement croissante, il n'y a pas de cycle.

import type { CityRecord } from "./types.ts";
import { haversineKm } from "./haversine.ts";

/** Rayon du cluster autour de chaque ville (km). */
export const CLUSTER_RADIUS_KM = 15;

export interface ClusterIndex {
  /** id de la ville de référence du cluster de la ville donnée. */
  refOf(cityId: string): string;
  /** true si la ville est elle-même une référence (affichée / cliquable). */
  isRef(cityId: string): boolean;
  /** Ville de référence du cluster de `city` (objet complet). */
  refCity(city: CityRecord): CityRecord;
  /** Nombre de références (taille de la constellation affichée). */
  refCount(): number;
}

// Cellules de la grille maison (~0,1° ≈ 11 km en latitude) ; on scanne 5×5
// cellules autour de la ville (≥ 0,5° ≈ 55 km N-S, ≥ 27 km E-O à 60°N),
// ce qui couvre largement le disque de 15 km, puis on filtre à la distance exacte.
const CELL_DEG = 0.1;
const SCAN = 5;

export function buildClusterIndex(
  cities: readonly CityRecord[],
  radiusKm: number = CLUSTER_RADIUS_KM,
): ClusterIndex {
  const grid = new Map<string, CityRecord[]>();
  const byId = new Map<string, CityRecord>();
  for (const c of cities) {
    byId.set(c.id, c);
    const key = Math.floor(c.lat / CELL_DEG) + "," + Math.floor(c.lng / CELL_DEG);
    const bucket = grid.get(key);
    if (bucket) bucket.push(c);
    else grid.set(key, [c]);
  }

  /** Ville la plus peuplée à ≤ radiusKm de `c` (elle-même incluse) ; tie-break : id croissant. */
  function mostPopulatedNear(c: CityRecord): CityRecord {
    let best: CityRecord = c;
    const clat = Math.floor(c.lat / CELL_DEG);
    const clng = Math.floor(c.lng / CELL_DEG);
    for (let dx = -SCAN; dx <= SCAN; dx++) {
      for (let dy = -SCAN; dy <= SCAN; dy++) {
        const bucket = grid.get(clat + dx + "," + (clng + dy));
        if (!bucket) continue;
        for (const o of bucket) {
          if (haversineKm(c.lat, c.lng, o.lat, o.lng) > radiusKm) continue;
          if (o.population > best.population || (o.population === best.population && o.id < best.id)) {
            best = o;
          }
        }
      }
    }
    return best;
  }

  // Étape 1 : association directe.
  const ref0 = new Map<string, string>();
  for (const c of cities) {
    ref0.set(c.id, mostPopulatedNear(c).id);
  }

  // Étape 2 : point fixe ref(V) = ref(ref(V)).
  const ref = new Map<string, string>();
  for (const c of cities) {
    let cur = c.id;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      const next = ref0.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    ref.set(c.id, cur);
  }

  let refCount = 0;
  for (const id of ref.keys()) {
    if (ref.get(id) === id) refCount++;
  }

  return {
    refOf: (cityId) => ref.get(cityId) ?? cityId,
    isRef: (cityId) => ref.get(cityId) === cityId,
    refCity: (city) => {
      const r = byId.get(ref.get(city.id) ?? city.id);
      return r ?? city;
    },
    refCount: () => refCount,
  };
}
