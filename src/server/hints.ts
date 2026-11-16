// Projection des indices A → E à partir du « journey » (spécification §1.2
// et §4). « Ne pas générer les indices à la main » (§10) : tout découle de
// cette projection, un seul endroit à maintenir.

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
 * Affinement de l'indice D : la compagnie derrière chaque ligne. Table
 * modeste et extensible ; une ligne inconnue reste sa propre compagnie.
 */
const CARRIER_BY_LINE: Record<string, string> = {
  "TGV inOui": "inOui (SNCF)",
  "Métro ligne 5": "RATP",
  "RER B": "RATP",
  "Air France": "Air France",
  "S-Bahn S7 (ÖBB)": "ÖBB",
};

/** Segments de transport : les correspondances ne comptent pas (§4). */
export function transportSegments(journey: Journey): JourneySegment[] {
  return journey.segments.filter((s) => s.kind !== "connection");
}

function companyFor(segment: JourneySegment): string {
  return CARRIER_BY_LINE[segment.lineOrCarrier] ?? segment.lineOrCarrier;
}

/**
 * Indice E : une étape desservie du trajet — jamais la destination, ni
 * l'avant-dernière étape (§1.2). Les arrêts du dernier segment (celui qui
 * mène à la destination) sont exclus ; les « intermediateStops » d'un
 * segment ne contiennent de toute façon jamais ses extrémités. Choix
 * déterministe : le candidat le plus central de la liste dédupliquée.
 */
function intermediateStop(journey: Journey): string | null {
  const candidates: string[] = [];
  for (const segment of journey.segments.slice(0, -1)) {
    for (const stop of segment.intermediateStops ?? []) {
      candidates.push(stop);
    }
  }
  if (candidates.length === 0) return null;
  const unique = [...new Set(candidates)];
  return unique[Math.floor(unique.length / 2)] ?? null;
}

/** Les cinq indices, dans l'ordre de déblocage. */
export function buildHints(journey: Journey): Hint[] {
  const segments = transportSegments(journey);
  const categories = segments.map((s) => CATEGORY[s.kind as TransportMode]);
  const withDurations = segments.map(
    (s) => CATEGORY[s.kind as TransportMode] + " · " + s.durationMin + " min",
  );
  const companies = [...new Set(segments.map(companyFor))];
  const stop = intermediateStop(journey);
  return [
    { key: "A", title: "Modes de transport", body: categories.join("  →  ") },
    { key: "B", title: "Modes et durées", body: withDurations.join("  →  ") },
    {
      key: "C",
      title: "Lignes et compagnies",
      body: segments.map((s) => s.lineOrCarrier).join("  ·  "),
    },
    { key: "D", title: "Compagnies empruntées", body: companies.join("  ·  ") },
    {
      key: "E",
      title: "Étape intermédiaire",
      body:
        stop === null
          ? "Tous les arrêts intermédiaires révéleraient la destination"
          : "Le trajet s'arrête à " + stop,
    },
  ];
}

/** Indices débloqués après « failedAttempts » essais manqués (1 échec → A, …, 5 → E). */
export function unlockedHints(journey: Journey, failedAttempts: number): Hint[] {
  return buildHints(journey).slice(0, Math.max(0, Math.min(5, failedAttempts)));
}
