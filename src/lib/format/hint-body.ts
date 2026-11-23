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

/* ---------- Logos des modes de transport (indices A et B) ---------- */

/**
 * Libellé de mode (tel qu'envoyé par le serveur dans les indices A/B) → logo.
 * Ordre décroissant de longueur pour matcher « Transports urbains » avant
 * toute sous-chaîne malencontreuse.
 */
export const HINT_MODE_EMOJIS: ReadonlyArray<readonly [label: string, emoji: string]> = [
  ["Transports urbains", "🚇"],
  ["Bus interurbain", "🚌"],
  ["Avion", "✈️"],
  ["Train", "🚆"],
];

export interface HintSegment {
  /** Logo du mode, ou null si le segment n'en a pas reconnu. */
  emoji: string | null;
  /** Libellé du mode reconnu (ex. « Train »), ou null. */
  label: string | null;
  /** Reste du segment après le mode (ex. « · 1 h 47 » pour l'indice B). */
  rest: string;
}

/**
 * Découpe le corps d'un indice A/B en segments (« … → … ») et reconnaît le
 * mode de chacun pour poser son logo. Purement d'affichage.
 */
export function splitHintSegments(body: string): HintSegment[] {
  return body
    .split("→")
    .map((raw) => {
      const text = raw.trim();
      for (const [label, emoji] of HINT_MODE_EMOJIS) {
        if (text === label || text.startsWith(label + " ") || text.startsWith(label + "·")) {
          return { emoji, label, rest: text.slice(label.length).trim() };
        }
      }
      return { emoji: null, label: null, rest: text };
    })
    .filter((s) => s.rest !== "" || s.label !== null);
}
