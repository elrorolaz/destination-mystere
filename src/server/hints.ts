// Projection des indices A → D à partir du journey (spécification §1.2
// et §4, version maquette v5). « Ne pas générer les indices à la main » (§10) :
// tout découle de cette projection, un seul endroit à maintenir.
//
// Ordre de déblocage : A après le 1er essai manqué, B après le 2e, C après
// le 3e, D après le 4e — puis les deux derniers essais (5e et 6e) se jouent
// sans nouvel indice.

import type { Journey, JourneySegment, TransportMode } from "./routing/types.ts";

export type HintKey = "A" | "B" | "C" | "D";

export interface Hint {
  key: HintKey;
  title: string;
  body: string;
}

/** Catégories de l'indice A (§1.2) : trois familles, jamais le détail. */
const CATEGORY: Record<TransportMode, string> = {
  rail: "Train",
  air: "Avion",
  urban: "Transports urbains",
  intercity_bus: "Bus interurbain",
};

/** Segments de transport : les correspondances ne comptent pas (§4). */
export function transportSegments(journey: Journey): JourneySegment[] {
  return journey.segments.filter((s) => s.kind !== "connection");
}

/**
 * Indice D : un POINT DE CORRESPONDANCE du trajet — la jonction entre deux
 * tronçons de transport (le « to » d'un segment de transport, identique au
 * « from » du suivant) — et JAMAIS un simple arrêt d'un train, ni le premier
 * point (le départ), ni le dernier (la destination). Choix déterministe : le
 * candidat le plus central de la liste dédupliquée.
 */
function correspondencePoint(journey: Journey): string | null {
  const segs = journey.segments;
  const transportIdx = segs
    .map((s, i) => (s.kind === "connection" ? -1 : i))
    .filter((i) => i >= 0);
  const lastTransport = transportIdx[transportIdx.length - 1] ?? -1;
  const firstPoint = segs[0]?.from ?? "";
  const lastPoint = segs[segs.length - 1]?.to ?? "";
  const candidates: string[] = [];
  for (const i of transportIdx) {
    if (i === lastTransport) continue; // sa destination = le but, jamais révélé
    const to = segs[i]?.to ?? "";
    if (to && to !== firstPoint && to !== lastPoint) candidates.push(to);
  }
  if (candidates.length === 0) return null;
  const unique = [...new Set(candidates)];
  return unique[Math.floor(unique.length / 2)] ?? null;
}

/** Les quatre indices, dans l'ordre de déblocage. */
export function buildHints(journey: Journey): Hint[] {
  const segments = transportSegments(journey);
  const categories = segments.map((s) => CATEGORY[s.kind as TransportMode]);
  const withDurations = segments.map(
    (s) => CATEGORY[s.kind as TransportMode] + " · " + s.durationMin + " min",
  );
  const hub = correspondencePoint(journey);
  return [
    { key: "A", title: "Modes de transport", body: categories.join("  →  ") },
    { key: "B", title: "Modes et durées", body: withDurations.join("  →  ") },
    {
      key: "C",
      title: "Lignes et compagnies",
      body: segments.map((s) => s.lineOrCarrier).join("  ·  "),
    },
    {
      key: "D",
      title: "Point de correspondance",
      body:
        hub === null
          ? "Aucun point de correspondance intermédiaire sur ce trajet"
          : "Le trajet passe par " + hub,
    },
  ];
}

/**
 * Indices débloqués après « failedAttempts » essais manqués :
 * 1 échec → A, …, 4 échecs → D. Les essais 5 et 6 ne débloquent rien
 * (plafond à 4 indices, deux derniers essais « nus »).
 */
export function unlockedHints(journey: Journey, failedAttempts: number): Hint[] {
  return buildHints(journey).slice(0, Math.max(0, Math.min(4, failedAttempts)));
}
