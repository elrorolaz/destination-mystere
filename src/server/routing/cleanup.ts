// Nettoyage d'un journey avant stockage/publication (M2+) :
// fusion des correspondances à pied de quelques minutes en DÉBUT et en FIN
// d'itinéraire dans le premier/dernier tronçon de transport.
//
// Constat : le routeur (MOTIS) fait souvent commencer/terminer l'itinéraire
// par un leg à pied « START → gare » (ou « gare → END ») de 0–2 min, ce qui
// produit un segment « connection » de 1 min en première/dernière position —
// illisible pour le joueur (indice B, écran de fin). On fond cette marche
// d'accès dans le tronçon de transport voisin : le trajet reste portes-à-portes
// (durée totale inchangée), le chaînage reste valide, et les indices A/B/C
// ne changent pas (les correspondances n'y figuraient déjà pas).
//
// On ne fusionne PAS dans un segment « air » (un vol part toujours de
// l'aéroport), et on ne touche jamais aux correspondances intermédiaires.

import type { JourneySegment } from "./types.ts";

/** Une correspondance d'accès en bordure est fondue si elle dure ≤ ce seuil (min). */
export const EDGE_CONNECTION_MAX_MIN = 2;

function isTransport(s: JourneySegment): boolean {
  return s.kind !== "connection";
}

/**
 * Fond les segments « connection » de durée ≤ EDGE_CONNECTION_MAX_MIN situés
 * en tête/queue de liste dans le premier/dernier segment de transport voisin.
 * Réindexe les segments (index = position + 1). Ne modifie pas la durée totale.
 */
export function mergeEdgeConnections(segments: JourneySegment[]): JourneySegment[] {
  const out = segments.map((s) => ({ ...s }));

  // Tête : START → gare (1 min) fusionné dans le premier tronçon de transport.
  while (out.length > 1) {
    const first = out[0]!;
    const next = out[1]!;
    if (first.kind !== "connection" || first.durationMin > EDGE_CONNECTION_MAX_MIN) break;
    if (!isTransport(next) || next.kind === "air") break;
    out[1] = {
      ...next,
      from: first.from,
      fromCoord: first.fromCoord ?? next.fromCoord,
      durationMin: next.durationMin + first.durationMin,
    };
    out.shift();
  }

  // Queue : gare → END (1 min) fusionné dans le dernier tronçon de transport.
  while (out.length > 1) {
    const last = out[out.length - 1]!;
    const prev = out[out.length - 2]!;
    if (last.kind !== "connection" || last.durationMin > EDGE_CONNECTION_MAX_MIN) break;
    if (!isTransport(prev) || prev.kind === "air") break;
    out[out.length - 2] = {
      ...prev,
      to: last.to,
      toCoord: last.toCoord ?? prev.toCoord,
      durationMin: prev.durationMin + last.durationMin,
    };
    out.pop();
  }

  return out.map((s, i) => ({ ...s, index: i + 1 }));
}
