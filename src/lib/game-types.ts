// Types du payload public du jeu — partagés entre les routes API et l'écran
// de jeu (M3).
//
// CONTRAT ANTI-TRICHE (spécification §7) : aucun de ces types ne transporte
// le « journey » complet ni la destination tant que la partie est ACTIVE.
// Le serveur reste seul maître de la vérité ; ce fichier ne contient aucune
// logique de jeu, uniquement des formes de données.

export type PublicStatus = "ACTIVE" | "WON" | "LOST";

/** Statut d'une manche (itinéraire) du match : PENDING = pas encore commencée. */
export type PublicRouteStatus = PublicStatus | "PENDING";

/** Nombre d'itinéraires joués chaque jour (match en 3 manches). */
export const ROUTE_COUNT = 3;

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

/** Résultat public d'une manche (itinéraire) du match. */
export interface PublicRouteResult {
  /** 1..ROUTE_COUNT. */
  index: number;
  status: PublicRouteStatus;
  attemptCount: number;
  score: number;
  /** Départ de l'itinéraire — révélé quand la manche est terminée. */
  origin: PublicCityInfo | null;
  /** Destination — révélée quand la manche est terminée (§7). */
  destination: PublicCityInfo | null;
  /** Distance du dernier essai à la destination (manche terminée). */
  lastDistanceKm: number | null;
}

export interface PublicChallengeState {
  /** Clé AAAA-MM-JJ du défi, fuseau Europe/Paris. */
  date: string;
  /** Manche en cours : 1..routeCount. */
  routeIndex: number;
  /** Nombre d'itinéraires du match (3). */
  routeCount: number;
  /** Vrai quand les 3 manches sont terminées → écran de résultat final. */
  matchFinished: boolean;
  /** Somme des scores des manches terminées. */
  totalScore: number;
  /** Un résumé par itinéraire (3 entrées). */
  routeResults: PublicRouteResult[];
  // --- état de la manche courante ---
  origin: PublicCityInfo;
  totalDurationMin: number;
  status: PublicStatus;
  attemptCount: number;
  score: number;
  guesses: PublicGuess[];
  hints: PublicHint[];
  /** Fin de manche uniquement (§7). */
  destination: PublicCityInfo | null;
  /** Fin de manche uniquement (§7). */
  journey: PublicJourneyView | null;
}

/** Tracé d'un segment pour l'écran de fin : points [lat, lng]. */
export interface SegmentTrace {
  index: number;
  kind: string;
  /** Itinéraire d'origine (1..3) quand plusieurs itinéraires sont tracés. */
  routeIndex?: number;
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
