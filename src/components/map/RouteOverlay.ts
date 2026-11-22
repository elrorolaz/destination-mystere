// Tracés de l'itinéraire sur la carte (M3) — fin de partie.
// rail/urban : voies ferrées réelles servies par /api/route-geometry (Overpass,
// ou repli sur la géométrie réelle du leg rejoué auprès du routeur MOTIS).
// air : arc aérien. connection : pointillés.
//
// Design : le trajet doit « sauter aux yeux » — chaque tronçon est dessiné en
// DEUX couches : un halo très large et lumineux (glow) sous un cœur épais de
// couleur très vive (palette du thème courant, sombre ou clair).
// Idempotent : rappelable (rechargement du style, changement de thème).

import type { GeoJSONSource, LayerSpecification, Map as MLMap } from "maplibre-gl";
import type { SegmentTrace } from "@/lib/game-types";
import type { GamePalette } from "./map-themes";

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

interface RouteGroup {
  id: string;
  kinds: string[];
  color: string;
  glow: string;
  width: number; // épaisseur du cœur au zoom 10 (×2), interpolée depuis le zoom 3
  dash: number[] | null;
}

/** Groupes de tracé construits depuis la palette du thème (très marqué). */
function groupsOf(p: GamePalette): RouteGroup[] {
  return [
    { id: "route-conn", kinds: ["connection"], color: p.routeConn, glow: p.routeConn, width: 2.2, dash: [0.4, 1.8] },
    { id: "route-air", kinds: ["air"], color: p.routeAir, glow: p.routeAirGlow, width: 3.2, dash: [1.2, 2.2] },
    { id: "route-urban", kinds: ["urban"], color: p.routeUrban, glow: p.routeUrbanGlow, width: 4.2, dash: [2, 1.4] },
    { id: "route-rail", kinds: ["rail"], color: p.routeRail, glow: p.routeRailGlow, width: 5.2, dash: null },
  ];
}

function featureCollection(traces: SegmentTrace[], kinds: string[]) {
  return {
    type: "FeatureCollection" as const,
    features: lineTraces(traces, kinds).map((t) => ({
      type: "Feature" as const,
      properties: { index: t.index },
      geometry: { type: "LineString" as const, coordinates: toLine(t.geometry) },
    })),
  };
}

function widthExpr(width: number): unknown {
  return ["interpolate", ["linear"], ["zoom"], 3, Math.max(1.6, width * 0.7), 10, width * 2.1];
}

function ensureSource(map: MLMap, sourceId: string, data: unknown): GeoJSONSource {
  const existing = map.getSource(sourceId);
  if (existing) {
    (existing as GeoJSONSource).setData(data as GeoJSON.FeatureCollection);
    return existing as GeoJSONSource;
  }
  map.addSource(sourceId, { type: "geojson", data: data as GeoJSON.FeatureCollection });
  return map.getSource(sourceId) as GeoJSONSource;
}

/** Ajoute (ou met à jour) l'ensemble des couches de tracé, avec la palette du thème. */
export function addRouteOverlay(map: MLMap, traces: SegmentTrace[], palette: GamePalette): void {
  const groups = groupsOf(palette);

  // 1) Halos (glow) de tous les groupes — d'abord, pour passer sous les cœurs.
  for (const group of groups) {
    const sourceId = group.id + "-src";
    ensureSource(map, sourceId, featureCollection(traces, group.kinds));
    const glowId = group.id + "-glow";
    if (map.getLayer(glowId)) {
      // Le thème a pu changer : on recolorie le halo existant.
      try {
        map.setPaintProperty(glowId, "line-color", group.glow as never);
      } catch { /* ignore */ }
      continue;
    }
    map.addLayer({
      id: glowId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": group.glow,
        "line-opacity": 0.38,
        "line-width": widthExpr(group.width * 4.2),
        "line-blur": 3,
      },
    } as unknown as LayerSpecification);
  }

  // 2) Cœurs des lignes, par-dessus les halos (recolorés si le thème change).
  for (const group of groups) {
    const sourceId = group.id + "-src";
    ensureSource(map, sourceId, featureCollection(traces, group.kinds));
    if (map.getLayer(group.id)) {
      try {
        map.setPaintProperty(group.id, "line-color", group.color as never);
      } catch { /* ignore */ }
      continue;
    }
    const paint: Record<string, unknown> = {
      "line-color": group.color,
      "line-width": widthExpr(group.width),
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
  const midSourceId = "route-air-mid-src";
  ensureSource(map, midSourceId, midData);
  if (!map.getLayer("route-air-icon")) {
    if (mids.length === 0) return;
    map.addLayer({
      id: "route-air-icon",
      type: "symbol",
      source: midSourceId,
      layout: {
        "text-field": "✈",
        "text-font": ["Noto Sans Regular"],
        "text-size": 16,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": palette.airIcon,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.6,
      },
    } as unknown as LayerSpecification);
  } else {
    try {
      map.setPaintProperty("route-air-icon", "text-color", palette.airIcon as never);
      map.setPaintProperty("route-air-icon", "text-halo-color", palette.labelHalo as never);
    } catch { /* ignore */ }
  }
}

const GROUP_IDS = ["route-conn", "route-air", "route-urban", "route-rail"];
const OVERLAY_LAYER_IDS: string[] = GROUP_IDS.flatMap((id): string[] => [id, id + "-glow"]).concat([
  "route-air-icon",
]);
const OVERLAY_SOURCE_IDS: string[] = GROUP_IDS.map((id): string => id + "-src").concat(["route-air-mid-src"]);

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
