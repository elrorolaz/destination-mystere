// Texte de partage du résultat (réseaux sociaux : WhatsApp, Instagram, X…).
// RÈGLE ABSOLUE (anti-spoiler) : le texte partagé ne doit JAMAIS contenir
// les itinéraires — ni nom de ville (départ/destination), ni détail du trajet.
// Seuls figurent la date, les carrés 🟥/🟩 de chaque itinéraire, les points
// par itinéraire et le score total (style « grille de score »).

import type { PublicChallengeState } from "../game-types.ts";

/**
 * Construit le texte partageable du match terminé : une ligne par itinéraire
 * (numéro, carrés des essais, points) + le score total. Aucun nom de ville.
 */
export function buildShareText(state: PublicChallengeState): string {
  const lines = state.routeResults.map(
    (r) =>
      "Itinéraire " +
      r.index +
      " : " +
      (r.squares === "" ? "—" : r.squares) +
      " — " +
      r.score +
      " pts",
  );
  return (
    [
      "🧭 Itinaris — défi du " + state.date,
      ...lines,
      "Score total : " + state.totalScore + " pts",
      "Peux-tu faire mieux ?",
    ].join("\n")
  );
}
