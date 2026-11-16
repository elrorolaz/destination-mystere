// Score standard et score de proximité (spécification §1.3).

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

/**
 * Score de proximité après un 6e échec (§1.3) : arrondi de
 * 250 × (1 − d/200) où d est la distance du dernier clic au but,
 * 0 au-delà de 200 km ou en cas d'entrée invalide.
 */
export function proximityScore(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  return Math.max(0, Math.round(250 * (1 - distanceKm / 200)));
}
