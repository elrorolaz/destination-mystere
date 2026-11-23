// Mise en forme D'AFFICHAGE du corps d'un indice (§1.2).
//
// Le serveur envoie les durées en minutes entières (métier en minutes) ;
// l'indice B les affiche en heures et minutes à l'écran : « Avion · 107 min »
// devient « Avion · 1 h 47 ». Aucun changement de logique : ce fichier est
// purement cosmétique et n'est utilisé que par les composants d'affichage.

import { formatDuration } from "./duration.ts";

/**
 * Reformate le corps d'un indice pour l'affichage.
 * - indice « B » : chaque « N min » est rendu en heures/minutes (formatDuration) ;
 * - autres indices : texte tel quel.
 */
export function formatHintBody(key: string, body: string): string {
  if (key !== "B") return body;
  return body.replace(/(\d+)\s*min\b/g, (_match, minutes) =>
    formatDuration(Number(minutes)),
  );
}
