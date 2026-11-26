// Projection des indices A → E à partir du journey (spécification §1.2
// et §4, version maquette v5). « Ne pas générer les indices à la main » (§10) :
// tout découle de cette projection, un seul endroit à maintenir.
//
// Ordre de déblocage : A après le 1er essai manqué, B après le 2e, C après
// le 3e, D après le 4e, E (pays de la destination) après le 5e — il ne reste
// alors plus qu'un seul essai (le 6e).

import { countryName } from "../lib/countries.ts";
import type { Journey, JourneySegment, TransportMode } from "./routing/types.ts";

export type HintKey = "A" | "B" | "C" | "D" | "E";

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

/**
 * Catégorie de l'indice A pour un segment de transport : le RER (et assimilés
 * : DLR, Overground…) compte comme TRANSPORT EN COMMUN (« Transports urbains »),
 * jamais comme « Train » ; chaque TER, TGV, Intercités… reste un « Train ».
 */
function categoryOf(s: JourneySegment): string {
  if (s.kind === "rail" && /^(RER|DLR|Overground|Elizabeth line)/i.test(s.modeDetail)) {
    return CATEGORY.urban;
  }
  return CATEGORY[s.kind as TransportMode] ?? "Train";
}

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

/**
 * Les cinq indices, dans l'ordre de déblocage. L'indice E (pays de la
 * destination) ne découle pas du journey : il vient du pays de la ville
 * destination (`destCountry`, code ISO) — fourni par l'appelant.
 */
export function buildHints(journey: Journey, destCountry?: string): Hint[] {
  const segments = transportSegments(journey);
  const categories = segments.map((s) => categoryOf(s));
  const withDurations = segments.map(
    (s) => categoryOf(s) + " · " + s.durationMin + " min",
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
    {
      key: "E",
      title: "Pays de la destination",
      body:
        destCountry === undefined || destCountry === ""
          ? "Pays de la destination non disponible"
          : "La destination se trouve en " + countryName(destCountry) + " (" + destCountry + ")",
    },
  ];
}

/**
 * Indices débloqués après « failedAttempts » essais manqués (6 essais au
 * total, inchangé) : 1 échec → A, …, 4 échecs → D, 5 échecs → E (pays de la
 * destination) — il ne reste alors plus qu'un seul essai (le 6e).
 */
export function unlockedHints(
  journey: Journey,
  failedAttempts: number,
  destCountry?: string,
): Hint[] {
  return buildHints(journey, destCountry).slice(0, Math.max(0, Math.min(5, failedAttempts)));
}
