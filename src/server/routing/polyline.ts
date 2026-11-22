// Décodeur de polyline Google (precision 5) — MOTIS renvoie la géométrie de
// chaque leg dans legGeometry.points sous ce format encodé.

import type { LatLon } from "./rail-geometry.ts";

/**
 * Décode une polyline encodée (algorithme Google, précision 1e-5 degré)
 * en liste de points [lat, lng]. Entrée invalide → liste vide.
 */
export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;
  while (index < len) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= len) return points; // tronqué : on garde ce qu'on a
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      if (index >= len) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}
