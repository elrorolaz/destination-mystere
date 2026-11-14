// Distance orthodromique (haversine) — rayon terrestre moyen 6371 km.
// Les bornes inférieures de l'index spatial (grid-index.ts) s'appuient sur
// les approximations de ce module : 1° de latitude ≈ 110,574 km partout,
// 1° de longitude ≈ 111,320 × cos(latitude) km. Toute valeur utilisée comme
// borne conservative doit être un minorant de la distance réelle.

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_EQUATOR = 111.32;

/** Convertit un écart en degrés de latitude vers des kilomètres (minorant). */
export function kmPerDegreeLat(): number {
  return KM_PER_DEG_LAT;
}

/**
 * Convertit un écart en degrés de longitude vers des kilomètres à une
 * latitude donnée. `cosLat` doit être le cosinus le plus PETIT rencontré
 * dans la plage de latitudes concernée pour obtenir un minorant.
 */
export function kmPerDegreeLng(cosLat: number): number {
  return KM_PER_DEG_LNG_EQUATOR * Math.max(cosLat, 0);
}

/** Distance orthodromique en kilomètres entre deux points WGS84. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Point situé à `distanceKm` de (lat, lng) dans l'azimut `bearingDeg`
 * (0 = nord, 90 = est). Sert aux tests : générer un clic à N km d'une ville.
 */
export function destinationPoint(
  lat: number,
  lng: number,
  distanceKm: number,
  bearingDeg: number,
): { lat: number; lng: number } {
  const toRad = Math.PI / 180;
  const angular = distanceKm / EARTH_RADIUS_KM;
  const bearing = bearingDeg * toRad;
  const lat1 = lat * toRad;
  const lng1 = lng * toRad;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: lat2 / toRad, lng: lng2 / toRad };
}
