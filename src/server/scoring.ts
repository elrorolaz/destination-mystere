// Score standard, score de proximité et multiplicateurs par itinéraire
// (spécification §1.3, échelonnement de la difficulté sur les 3 itinéraires).

export const MAX_ATTEMPTS = 6;

/** Score par essai réussi : 1000, 850, 700, 550, 400, 250. */
export const STANDARD_SCORES = [1000, 850, 700, 550, 400, 250] as const;

/** Score d'une victoire à l'essai « attemptNumber » (1 à 6). */
export function standardScore(attemptNumber: number): number {
  if (
    !Number.isInteger(attemptNumber) ||
    attemptNumber < 1 ||
    attemptNumber > MAX_ATTEMPTS
  ) {
    throw new Error("standardScore : essai hors bornes " + String(attemptNumber));
  }
  const score = STANDARD_SCORES[attemptNumber - 1];
  return score ?? 0;
}

/* ---------- Score de proximité (échec au dernier essai) ---------- */

/**
 * Rayon de la zone de proximité : 300 km. Au-delà, le score de proximité
 * vaut 0.
 */
export const PROXIMITY_RADIUS_KM = 300;
/** Points de référence à 0 km — la valeur d'une victoire au DERNIER essai (6ᵉ). */
export const PROXIMITY_MAX_POINTS = STANDARD_SCORES[MAX_ATTEMPTS - 1] ?? 250;

/**
 * Score de proximité après le dernier essai (§1.3) : la DERNIÈRE réponse
 * rapporte un score dégressif selon sa distance d au but —
 * arrondi de 250 × (1 − d/300), c'est-à-dire la valeur d'une victoire au 6ᵉ
 * essai (250) multipliée par un facteur (1 − d/300) inversement
 * proportionnel à la distance. **0 si d dépasse 300 km** (ou entrée
 * invalide). Le résultat est donc toujours ≤ 250 : être proche ne rapporte
 * jamais plus que trouver la ville.
 */
export function proximityScore(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  if (distanceKm >= PROXIMITY_RADIUS_KM) return 0;
  return Math.round(PROXIMITY_MAX_POINTS * (1 - distanceKm / PROXIMITY_RADIUS_KM));
}

/* ---------- Multiplicateur de score par itinéraire ---------- */

/**
 * Multiplicateur de score de chaque itinéraire du match (1..3), qui suit la
 * difficulté croissante : ×1 pour le premier (villes majeures), ×1,5 pour le
 * deuxième, ×2 pour le troisième (toutes les villes). Le score final reste le
 * total des trois manches.
 */
export const ROUTE_SCORE_MULTIPLIERS = [1, 1.5, 2] as const;

/** Multiplicateur de l'itinéraire `routeIndex` (1-based, borné). */
export function routeScoreMultiplier(routeIndex: number): number {
  const i = Math.min(
    Math.max(Math.trunc(routeIndex) - 1, 0),
    ROUTE_SCORE_MULTIPLIERS.length - 1,
  );
  return ROUTE_SCORE_MULTIPLIERS[i] ?? 1;
}

/** Applique le multiplicateur de l'itinéraire à un score brut (arrondi). */
export function applyRouteMultiplier(score: number, routeIndex: number): number {
  if (!Number.isFinite(score) || score < 0) return 0;
  return Math.round(score * routeScoreMultiplier(routeIndex));
}
