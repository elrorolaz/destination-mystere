// Tracés des itinéraires sur la carte (M3+) — fin de manche ou fin de match.
// rail/urban : voies ferrées réelles servies par /api/route-geometry (Overpass,
// ou repli sur la géométrie réelle du leg rejoué auprès du routeur MOTIS).
// air : arc aérien. connection : pointillés.
//
// Plusieurs itinéraires peuvent être tracés en même temps (écran de résultat
// final) : chaque itinéraire a sa PROPRE COULEUR et son NUMÉRO (1, 2, 3) posé
// au milieu de son tracé, pour les distinguer.
//
// Design : le trajet doit « sauter aux yeux » — chaque tronçon est dessiné en
// DEUX couches : un halo très large et lumineux (glow) sous un cœur épais de
// couleur vive. Idempotent : rappelable (rechargement du style, changement de
// thème).

import type { GeoJSONSource, LayerSpecification, Map as MLMap } from "maplibre-gl";
import { ROUTE_COUNT, type SegmentTrace } from "@/lib/game-types";
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

/** Couleur + glow de chaque itinéraire (1..3) : rouge, vert, bleu. */
export const ROUTE_COLORS = [
  { core: "#FF3B30", glow: "rgba(255, 59, 48, 0.55)" }, // itinéraire 1 — rouge
  { core: "#34C759", glow: "rgba(52, 199, 89, 0.55)" }, // itinéraire 2 — vert
  { core: "#3E9BFF", glow: "rgba(62, 155, 255, 0.55)" }, // itinéraire 3 — bleu
] as const;

/** Couleur d'un itinéraire (1-based ; défaut = itinéraire 1). */
export function routeColor(routeIndex: number | undefined): string {
  const i = Math.min(Math.max((routeIndex ?? 1) - 1, 0), ROUTE_COLORS.length - 1);
  return ROUTE_COLORS[i]!.core;
}

function lineTraces(traces: SegmentTrace[], route: number, kinds: string[]): SegmentTrace[] {
  return traces.filter(
    (t) => (t.routeIndex ?? 1) === route && kinds.includes(t.kind) && t.geometry.length >= 2,
  );
}

interface RouteGroup {
  id: string;
  kinds: string[];
  width: number; // épaisseur du cœur au zoom 10 (×2), interpolée depuis le zoom 3
  dash: number[] | null;
}

/** Groupes de tracé d'un itinéraire (par kind), colorés par la route. */
function groupsOf(): RouteGroup[] {
  return [
    { id: "conn", kinds: ["connection"], width: 2.2, dash: [0.4, 1.8] },
    { id: "air", kinds: ["air"], width: 3.2, dash: [1.2, 2.2] },
    { id: "urban", kinds: ["urban"], width: 4.2, dash: [2, 1.4] },
    { id: "rail", kinds: ["rail"], width: 5.2, dash: null },
  ];
}

function featureCollection(traces: SegmentTrace[]) {
  return {
    type: "FeatureCollection" as const,
    features: traces.map((t) => ({
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

/** Numéros d'itinéraires présents dans les tracés. */
function routeIndexesOf(traces: SegmentTrace[]): number[] {
  const set = new Set<number>();
  for (const t of traces) set.add(t.routeIndex ?? 1);
  return [...set].sort((a, b) => a - b);
}

/** Point « milieu » du tracé le plus long d'un itinéraire (pour le numéro). */
function routeLabelPoint(traces: SegmentTrace[], route: number): LngLat | null {
  const lines = traces.filter(
    (t) => (t.routeIndex ?? 1) === route && t.kind !== "connection" && t.geometry.length >= 2,
  );
  if (lines.length === 0) return null;
  const longest = lines.reduce((a, b) => (b.geometry.length > a.geometry.length ? b : a));
  const mid = longest.geometry[Math.floor(longest.geometry.length / 2)];
  return mid ? [mid[1], mid[0]] : null;
}

/**
 * Ajoute (ou met à jour) les couches de tracé de tous les itinéraires présents
 * dans `traces`, avec une couleur et un numéro par itinéraire.
 */
export function addRouteOverlay(map: MLMap, traces: SegmentTrace[], palette: GamePalette): void {
  if (traces.length === 0) return;
  const routes = routeIndexesOf(traces);
  const groups = groupsOf();

  for (const route of routes) {
    const color = routeColor(route);
    const glow = ROUTE_COLORS[Math.min(Math.max(route - 1, 0), ROUTE_COLORS.length - 1)]!.glow;
    const prefix = "dm-r" + route + "-";

    for (const group of groups) {
      const sourceId = prefix + group.id + "-src";
      const data = featureCollection(lineTraces(traces, route, group.kinds));
      ensureSource(map, sourceId, data);
      const glowId = prefix + group.id + "-glow";
      if (map.getLayer(glowId)) {
        try {
          map.setPaintProperty(glowId, "line-color", glow as never);
        } catch { /* ignore */ }
      } else if (lineTraces(traces, route, group.kinds).length > 0) {
        map.addLayer({
          id: glowId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": glow,
            "line-opacity": 0.38,
            "line-width": widthExpr(group.width * 4.2),
            "line-blur": 3,
          },
        } as unknown as LayerSpecification);
      }

      const coreId = prefix + group.id;
      if (map.getLayer(coreId)) {
        try {
          map.setPaintProperty(coreId, "line-color", color as never);
        } catch { /* ignore */ }
      } else if (lineTraces(traces, route, group.kinds).length > 0) {
        const paint: Record<string, unknown> = {
          "line-color": color,
          "line-width": widthExpr(group.width),
        };
        if (group.dash) paint["line-dasharray"] = group.dash;
        map.addLayer({
          id: coreId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint,
        } as unknown as LayerSpecification);
      }
    }

    // ✈ posé au milieu de chaque arc aérien de l'itinéraire.
    const mids: LngLat[] = [];
    for (const t of lineTraces(traces, route, ["air"])) {
      const mid = t.geometry[Math.floor(t.geometry.length / 2)];
      if (mid) mids.push([mid[1], mid[0]]);
    }
    const midSourceId = prefix + "air-icon-src";
    ensureSource(map, midSourceId, {
      type: "FeatureCollection" as const,
      features: mids.map((coordinates) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates },
      })),
    });
    const airIconId = prefix + "air-icon";
    if (!map.getLayer(airIconId) && mids.length > 0) {
      map.addLayer({
        id: airIconId,
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
    }

    // Numéro de l'itinéraire (1, 2, 3) au milieu de son tracé.
    const labelPoint = routeLabelPoint(traces, route);
    const labelSourceId = prefix + "label-src";
    ensureSource(map, labelSourceId, {
      type: "FeatureCollection" as const,
      features: labelPoint
        ? [
            {
              type: "Feature" as const,
              properties: { label: String(route) },
              geometry: { type: "Point" as const, coordinates: labelPoint },
            },
          ]
        : [],
    });
    const labelId = prefix + "label";
    if (!map.getLayer(labelId) && labelPoint) {
      map.addLayer({
        id: labelId,
        type: "symbol",
        source: labelSourceId,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 15,
          "text-allow-overlap": true,
          "text-anchor": "center",
        },
        paint: {
          "text-color": color,
          "text-halo-color": palette.labelHalo,
          "text-halo-width": 2.4,
        },
      } as unknown as LayerSpecification);
    }
  }
}

const KIND_IDS = ["conn", "air", "urban", "rail"];

/** Toutes les couches de tracé (tous itinéraires) — pour le nettoyage. */
function overlayLayerIds(): string[] {
  const ids: string[] = [];
  for (let r = 1; r <= ROUTE_COUNT; r++) {
    const prefix = "dm-r" + r + "-";
    for (const kind of KIND_IDS) ids.push(prefix + kind, prefix + kind + "-glow");
    ids.push(prefix + "air-icon", prefix + "label");
  }
  return ids;
}

function overlaySourceIds(): string[] {
  const ids: string[] = [];
  for (let r = 1; r <= ROUTE_COUNT; r++) {
    const prefix = "dm-r" + r + "-";
    for (const kind of KIND_IDS) ids.push(prefix + kind + "-src");
    ids.push(prefix + "air-icon-src", prefix + "label-src");
  }
  return ids;
}

/**
 * Supprime toutes les couches de tracé (nouvelle manche / nouvelle partie :
 * l'itinéraire précédent ne doit plus polluer la carte).
 */
export function removeRouteOverlay(map: MLMap): void {
  for (const id of overlayLayerIds()) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of overlaySourceIds()) {
    if (map.getSource(id)) map.removeSource(id);
  }
}
