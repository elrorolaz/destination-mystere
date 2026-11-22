// Décodeur de polyline Google (legGeometry MOTIS).

import { describe, expect, it } from "vitest";
import { decodePolyline } from "../src/server/routing/polyline.ts";

describe("decodePolyline (legGeometry MOTIS)", () => {
  it("décode l'exemple canonique de Google", () => {
    // Exemple de la doc Google : points (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
    const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decoded).toHaveLength(3);
    expect(decoded[0]![0]).toBeCloseTo(38.5, 5);
    expect(decoded[0]![1]).toBeCloseTo(-120.2, 5);
    expect(decoded[1]![0]).toBeCloseTo(40.7, 5);
    expect(decoded[1]![1]).toBeCloseTo(-120.95, 5);
    expect(decoded[2]![0]).toBeCloseTo(43.252, 5);
    expect(decoded[2]![1]).toBeCloseTo(-126.453, 5);
  });

  it("une chaîne vide → aucun point", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("une chaîne tronquée ne lève pas d'erreur", () => {
    const decoded = decodePolyline("_p~iF~ps");
    expect(Array.isArray(decoded)).toBe(true);
  });

  it("décode un aller simple Reims → Paris encodé localement (round-trip)", () => {
    const decoded = decodePolyline(encodePolyline([[49.2583, 4.0317], [48.8566, 2.3522]]));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]![0]).toBeCloseTo(49.2583, 4);
    expect(decoded[0]![1]).toBeCloseTo(4.0317, 4);
    expect(decoded[1]![0]).toBeCloseTo(48.8566, 4);
    expect(decoded[1]![1]).toBeCloseTo(2.3522, 4);
  });
});

/** Encode une polyligne (réimplémentation locale pour le test, précision 1e5). */
function encodePolyline(points: Array<[number, number]>): string {
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  for (const [lat, lng] of points) {
    const encLat = encodeValue(Math.round(lat * 1e5), prevLat);
    const encLng = encodeValue(Math.round(lng * 1e5), prevLng);
    out += encLat.str + encLng.str;
    prevLat = Math.round(lat * 1e5);
    prevLng = Math.round(lng * 1e5);
  }
  return out;
}

function encodeValue(v: number, prev: number): { str: string } {
  let diff = (v - prev) << 1;
  if (diff < 0) diff = ~diff;
  let str = "";
  while (diff >= 0x20) {
    str += String.fromCharCode((0x20 | (diff & 0x1f)) + 63);
    diff >>= 5;
  }
  str += String.fromCharCode(diff + 63);
  return { str };
}
