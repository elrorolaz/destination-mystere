// Types géographiques partagés — itinaris (M1)

/** Point géographique WGS84. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Ville issue du jeu de données GeoNames (cities5000, cf. spécification §5.3). */
export interface CityRecord extends GeoPoint {
  /** Identifiant GeoNames — jamais le nom (homonymes, cf. spécification §11.4). */
  id: string;
  name: string;
  /** Code pays ISO 2 lettres, ex. "FR". */
  country: string;
  population: number;
  /** Une gare de voyageurs se trouve à moins de 3 km (départs potentiels). */
  hasTrainStation: boolean;
  /** Geohash précision 6 — stocké en base pour de futurs usages (§4). */
  geohash: string;
}

/** Résultat d'un rattachement clic → ville. */
export interface SnapResult {
  city: CityRecord;
  /** Distance orthodromique entre le clic et la ville rattachée, en km. */
  distanceKm: number;
}

/** Aéroport issu d'OpenFlights (filtré Europe, internationaux uniquement). */
export interface AirportRecord extends GeoPoint {
  id: string;
  name: string;
  /** Nom de la ville desservie (champ OpenFlights, indicatif). */
  city: string;
  /** Nom complet du pays (convention OpenFlights, pas un code ISO). */
  country: string;
  /** Code pays ISO 2 lettres, ex. "FR" (via countries.dat). */
  countryCode?: string;
  /** Code IATA à 3 lettres, ex. "CDG". */
  iata: string;
  /** Type OpenFlights : « large_airport » = aéroport international retenu. */
  type?: string;
  /** Population de la plus grande ville à ≤ 45 km (0 si inconnu) : « majeur ». */
  hubPopulation?: number;
  /** Nom de cette plus grande ville à ≤ 45 km (ex. « Paris » pour CDG). */
  hubCity?: string;
}
