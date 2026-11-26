// Libellé du niveau de difficulté d'un itinéraire, à partir du seuil de
// population de sa destination (50 000 / 20 000 / 0). Purement cosmétique :
// le seuil lui-même vient du serveur (minPopulationForSlot).

/**
 * Libellé du type de villes possibles comme destination :
 * 50 000 → « villes ≥ 50 000 hab. », 20 000 → « villes ≥ 20 000 hab. »,
 * 0 (ou moins) → « toutes les villes ».
 */
export function formatDestTier(destMinPopulation: number): string {
  if (destMinPopulation >= 50000) return "villes ≥ 50 000 hab.";
  if (destMinPopulation >= 20000) return "villes ≥ 20 000 hab.";
  return "toutes les villes";
}

/** Libellé court pour badge : « ≥ 50 000 », « ≥ 20 000 », « toutes ». */
export function formatDestTierShort(destMinPopulation: number): string {
  if (destMinPopulation >= 50000) return "≥ 50 000 hab.";
  if (destMinPopulation >= 20000) return "≥ 20 000 hab.";
  return "toutes villes";
}
