// Dédoublonnage des villes affichées sur la carte (design M3+).
//
// À l'import, les arrondissements ont été renommés du nom de leur ville
// parente (scripts/lib/arrondissements.ts) : plusieurs lignes de la table
// City portent alors le même (country, name) — ex. « Paris » × 21. La carte
// ne doit afficher QU'UN SEUL point par ville : on garde la ligne la plus
// peuplée de chaque groupe, c'est-à-dire la ville parente (sa population est
// le total, supérieure à celle de chaque arrondissement).
//
// Le snap serveur, lui, conserve toutes les entrées : un clic dans le 13e
// vise toujours « Paris » avec la précision de l'arrondissement.

export interface CityLike {
  name: string;
  country: string;
  population: number;
}

/**
 * Garde une seule entrée par (country, name) : celle de plus grande
 * population. L'ordre d'entrée est préservé au mieux (première occurrence
 * du groupe, remplacée par la plus peuplée si elle arrive plus tard).
 */
export function dedupeCitiesByName<T extends CityLike>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.country + "|" + row.name;
    const prev = best.get(key);
    if (!prev) {
      order.push(key);
      best.set(key, row);
    } else if (row.population > prev.population) {
      best.set(key, row);
    }
  }
  return order.map((key) => best.get(key) as T);
}
