// Segment et itinéraire — structure pivot du jeu (spécification §4).
// Un seul champ `journey` alimente toute la mécanique : chaque indice est une
// projection de cette structure. À enrichir au jalon M2 (planner, clients).

export type TransportMode = "rail" | "air" | "urban" | "intercity_bus";

/**
 * Extension documentée : une correspondance (marche ou attente) est un
 * segment sans mode de transport. Elle est comptée dans la durée totale mais
 * n'apparaît pas dans l'indice A (modes de transport).
 */
export type SegmentKind = TransportMode | "connection";

export interface JourneySegment {
  index: number;
  kind: SegmentKind;
  /** TER, TGV, Métro, Tram, RER, Avion, S-Bahn… — indice A (si transport). */
  modeDetail: string;
  /** Ligne ou compagnie — indice C. */
  lineOrCarrier: string;
  /** Durée du segment en minutes — indice B. */
  durationMin: number;
  from: string;
  to: string;
  /** Arrêts desservis — source de l'indice D. */
  intermediateStops?: string[];
}

export interface Journey {
  totalDurationMin: number;
  segments: JourneySegment[];
}

/** Projection des indices à partir d'un itinéraire (implémentation M2). */
export interface DailyJourney extends Journey {
  /** Date du défi (AAAA-MM-JJ, fuseau Europe/Paris) — graine du tirage. */
  challengeDate: string;
  originCityId: string;
  destCityId: string;
}
