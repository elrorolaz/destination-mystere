// Types du payload public du jeu — partagés entre les routes API et l'écran
// de jeu (M3).
//
// CONTRAT ANTI-TRICHE (spécification §7) : aucun de ces types ne transporte
// le « journey » complet ni la destination tant que la partie est ACTIVE.
// Le serveur reste seul maître de la vérité ; ce fichier ne contient aucune
// logique de jeu, uniquement des formes de données.

export type PublicStatus = "ACTIVE" | "WON" | "LOST";

export interface PublicCityInfo {
  name: string;
  country: string;
  lat: number;
  lng: number;
}

export interface PublicGuess {
  attemptNumber: number;
  city: PublicCityInfo;
  /** Distance orthodromique ville devinée → destination, en km (§1.2). */
  distanceKm: number;
  correct: boolean;
}

export interface PublicHint {
  key: "A" | "B" | "C" | "D";
  title: string;
  body: string;
}

export interface PublicSegmentView {
  index: number;
  kind: string;
  modeDetail: string;
  lineOrCarrier: string;
  durationMin: number;
  from: string;
  to: string;
}

export interface PublicJourneyView {
  totalDurationMin: number;
  segments: PublicSegmentView[];
}

export interface PublicChallengeState {
  /** Clé AAAA-MM-JJ du défi, fuseau Europe/Paris. */
  date: string;
  origin: PublicCityInfo;
  totalDurationMin: number;
  status: PublicStatus;
  attemptCount: number;
  score: number;
  guesses: PublicGuess[];
  hints: PublicHint[];
  /** Fin de partie uniquement (§7). */
  destination: PublicCityInfo | null;
  /** Fin de partie uniquement (§7). */
  journey: PublicJourneyView | null;
}

/** Tracé d'un segment pour l'écran de fin : points [lat, lng]. */
export interface SegmentTrace {
  index: number;
  kind: string;
  /**
   * Vrai si la géométrie suit une infrastructure réelle : voies ferrées
   * OpenStreetMap pour rail/urban, arc aérien pour air. Faux pour une ligne
   * droite indicative (correspondance ou repli).
   */
  followsTracks: boolean;
  geometry: Array<[number, number]>;
}

/** Ville renvoyée à la carte (couche « constellation », M3). */
export interface CityMapPoint {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
  hasTrainStation: boolean;
}
