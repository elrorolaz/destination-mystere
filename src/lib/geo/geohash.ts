// Geohash (Base32, algorithme de référence) — encodage, bornes de cellule
// et métriques. Validé contre les ancres de l'article Wikipédia :
//   encodeGeohash(42.605, -5.603, 5) === "ezs42"
//   bornes de "ezs42" : lat [42.583, 42.627], lng [-5.625, -5.581]

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const BIT_MASKS = [16, 8, 4, 2, 1];

/** Encode un point WGS84 en geohash de `precision` caractères. */
export function encodeGeohash(
  lat: number,
  lng: number,
  precision: number,
): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  let hash = "";
  let bit = 0;
  let charIndex = 0;
  let even = true; // true = longitude, false = latitude

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        charIndex |= BIT_MASKS[bit] ?? 0;
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        charIndex |= BIT_MASKS[bit] ?? 0;
        latMin = mid;
      } else {
        latMax = mid;
      }
    }

    even = !even;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[charIndex] ?? "";
      bit = 0;
      charIndex = 0;
    }
  }

  return hash;
}

/** Bornes [min, max] de la cellule couverte par un geohash. */
export function decodeGeohashBounds(geohash: string): {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;

  for (const char of geohash) {
    const index = BASE32.indexOf(char.toLowerCase());
    if (index === -1) {
      throw new Error(`Caractère geohash invalide : "${char}"`);
    }
    for (const mask of BIT_MASKS) {
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if ((index & mask) !== 0) {
          lngMin = mid;
        } else {
          lngMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if ((index & mask) !== 0) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      even = !even;
    }
  }

  return { latMin, latMax, lngMin, lngMax };
}

/** Centre et dimensions (km) d'une cellule geohash. */
export function cellMetrics(geohash: string): {
  centerLat: number;
  centerLng: number;
  widthKm: number;
  heightKm: number;
} {
  const { latMin, latMax, lngMin, lngMax } = decodeGeohashBounds(geohash);
  const centerLat = (latMin + latMax) / 2;
  const centerLng = (lngMin + lngMax) / 2;
  const heightKm = ((latMax - latMin) * Math.PI * 6371) / 180;
  const widthKm =
    ((lngMax - lngMin) * Math.PI * 6371 * Math.cos((centerLat * Math.PI) / 180)) /
    180;
  return { centerLat, centerLng, widthKm, heightKm };
}
