// Tracés de l'itinéraire sur la carte (M3) — fin de partie.
// rail/urban : voies ferrées réelles servies par /api/route-geometry.
// air : arc aérien pointillé, ✈ posé au milieu. connection : pointillés brume.
// Idempotent : peut être rappelé (rechargement du style, strict mode).

import type { GeoJSONSource, LayerSpecification, Map as MLMap } from "maplibre-gl";
import type { SegmentTrace } from "@/lib/game-types";

type LngLat = [number, number]; // MapLibre : [lng, lat]

/** Les géométries serveur sont en [lat, lng] : on inverse pour la carte. */
function toLine(geometry: Array<[number, number]>): LngLat[] {
  const out: LngLat[] = [];
  for (const p of geometry) {
    out.push([p[1], p[0]]);
  }
  return out;
}

function lineTraces(traces: SegmentTrace[], kinds: string[]): SegmentTrace[] {
  return traces.filter((t) => kinds.includes(t.kind) && t.geometry.length >= 2);
}

const GROUPS = [
  { id: "route-conn", kinds: ["connection"], color: "#A9B4D0", width: 1.8, dash: [0.4, 1.8] },
  { id: "route-air", kinds: ["air"], color: "#E8B44A", width: 2.5, dash: [1.2, 2.4] },
  { id: "route-urban", kinds: ["urban"], color: "#E8B44A", width: 3, dash: [2, 1.4] },
  { id: "route-rail", kinds: ["rail"], color: "#E8B44A", width: 4, dash: null },
] as const;

/** Ajoute (ou met à jour) l'ensemble des couches de tracé. */
export function addRouteOverlay(map: MLMap, traces: SegmentTrace[]): void {
  for (const group of GROUPS) {
    const sourceId = group.id + "-src";
    const data = {
      type: "FeatureCollection" as const,
      features: lineTraces(traces, [...group.kinds]).map((t) => ({
        type: "Feature" as const,
        properties: { index: t.index },
        geometry: { type: "LineString" as const, coordinates: toLine(t.geometry) },
      })),
    };

    const existing = map.getSource(sourceId);
    if (existing) {
      (existing as GeoJSONSource).setData(data);
      continue;
    }
    map.addSource(sourceId, { type: "geojson", data });
    const paint: Record<string, unknown> = {
      "line-color": group.color,
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        Math.max(1.4, group.width * 0.7),
        10,
        group.width * 2,
      ],
    };
    if (group.dash) {
      paint["line-dasharray"] = group.dash;
    }
    map.addLayer({
      id: group.id,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint,
    } as unknown as LayerSpecification);
  }

  // ✈ posé au milieu de chaque arc aérien.
  const mids: LngLat[] = [];
  for (const t of lineTraces(traces, ["air"])) {
    const mid = t.geometry[Math.floor(t.geometry.length / 2)];
    if (mid) {
      mids.push([mid[1], mid[0]]);
    }
  }
  const midData = {
    type: "FeatureCollection" as const,
    features: mids.map((coordinates) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates },
    })),
  };
  const midSource = map.getSource("route-air-mid-src");
  if (midSource) {
    (midSource as GeoJSONSource).setData(midData);
    return;
  }
  if (mids.length === 0) {
    return;
  }
  map.addSource("route-air-mid-src", { type: "geojson", data: midData });
  map.addLayer({
    id: "route-air-icon",
    type: "symbol",
    source: "route-air-mid-src",
    layout: {
      "text-field": "✈",
      "text-font": ["Noto Sans Regular"],
      "text-size": 14,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#F5C96B", "text-halo-color": "#0B1023", "text-halo-width": 1.5 },
  } as unknown as LayerSpecification);
}

const OVERLAY_LAYER_IDS: string[] = GROUPS.map((g): string => g.id).concat(["route-air-icon"]);
const OVERLAY_SOURCE_IDS: string[] = GROUPS.map((g): string => g.id + "-src").concat(["route-air-mid-src"]);

/**
 * Supprime toutes les couches de tracé (nouvelle partie après un reroll :
 * l'itinéraire précédent ne doit plus polluer la carte).
 */
export function removeRouteOverlay(map: MLMap): void {
  for (const id of OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of OVERLAY_SOURCE_IDS) {
    if (map.getSource(id)) map.removeSource(id);
  }
}
