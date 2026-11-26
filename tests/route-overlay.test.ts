// RouteOverlay (M3+) : les tracés multi-itinéraires doivent être COLORÉS par
// itinéraire (rouge 1 / vert 2 / bleu 3 — et jamais repeints en beige par le
// thème de fond, cf. isGameSource) avec la distinction terrestrial/avion :
// rail + urbain en TRAIT PLEIN, avion en POINTILLÉS.

import { describe, expect, it } from "vitest";
import type { Map as MLMap } from "maplibre-gl";
import type { SegmentTrace } from "../src/lib/game-types.ts";
import {
  ROUTE_COLORS,
  addRouteOverlay,
  removeRouteOverlay,
  routeColor,
} from "../src/components/map/RouteOverlay.ts";
import type { GamePalette } from "../src/components/map/map-themes.ts";

interface LayerDef {
  id: string;
  source: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

function fakeMap() {
  const sources = new Map<string, { def: unknown; data: unknown; setData: (d: unknown) => void }>();
  const layers = new Map<string, LayerDef>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, def: unknown) => {
      const src = {
        def,
        data: (def as { data?: unknown })?.data,
        setData(d: unknown) {
          src.data = d;
        },
      };
      sources.set(id, src);
    },
    getLayer: (id: string) => layers.get(id),
    addLayer: (l: LayerDef) => {
      layers.set(l.id, l);
    },
    removeLayer: (id: string) => {
      layers.delete(id);
    },
    removeSource: (id: string) => {
      sources.delete(id);
    },
    setPaintProperty: (id: string, prop: string, value: unknown) => {
      const l = layers.get(id);
      if (l) (l.paint ??= {})[prop] = value;
    },
  } as unknown as MLMap;
  return { map, layers, sources };
}

const palette = { airIcon: "#fff", labelHalo: "#000" } as unknown as GamePalette;

const traces: SegmentTrace[] = [
  // itinéraire 1 : rail (terrestre)
  { index: 0, kind: "rail", routeIndex: 1, followsTracks: true, geometry: [[48.8, 2.3], [49.2, 4.0]] },
  // itinéraire 2 : avion
  { index: 1, kind: "air", routeIndex: 2, followsTracks: true, geometry: [[49.0, 2.5], [48.1, 16.5]] },
  // itinéraire 3 : rail + avion
  { index: 2, kind: "rail", routeIndex: 3, followsTracks: true, geometry: [[45.7, 4.8], [48.8, 2.3]] },
  { index: 3, kind: "air", routeIndex: 3, followsTracks: true, geometry: [[48.8, 2.3], [41.3, 2.1]] },
];

describe("RouteOverlay — couleurs par itinéraire et plein/pointillés", () => {
  it("chaque itinéraire a sa couleur (rouge/vert/bleu) sur cœur ET halo ET numéro", () => {
    const { map, layers } = fakeMap();
    addRouteOverlay(map, traces, palette);

    for (const [route, expected] of [
      [1, "#FF3B30"],
      [2, "#34C759"],
      [3, "#3E9BFF"],
    ] as const) {
      expect(routeColor(route)).toBe(expected);
      expect(layers.get(`dm-r${route}-rail`)?.paint?.["line-color"] ?? layers.get(`dm-r${route}-air`)?.paint?.["line-color"]).toBe(expected);
      const glow = layers.get(`dm-r${route}-rail-glow`) ?? layers.get(`dm-r${route}-air-glow`);
      expect(String(glow?.paint?.["line-color"])).toContain(String(expected).slice(1).toLowerCase() === "ff3b30" ? "255, 59, 48" : expected === "#34C759" ? "52, 199, 89" : "62, 155, 255");
      const label = layers.get(`dm-r${route}-label`);
      expect(label?.paint?.["text-color"]).toBe(expected);
    }
  });

  it("terrestre (rail/urban) = trait PLEIN (pas de dasharray), avion = POINTILLÉS", () => {
    const { map, layers } = fakeMap();
    addRouteOverlay(
      map,
      [
        { index: 0, kind: "rail", routeIndex: 1, followsTracks: true, geometry: [[48.8, 2.3], [49.2, 4.0]] },
        { index: 1, kind: "urban", routeIndex: 1, followsTracks: true, geometry: [[48.8, 2.3], [48.9, 2.4]] },
        { index: 2, kind: "air", routeIndex: 1, followsTracks: true, geometry: [[49.0, 2.5], [48.1, 16.5]] },
      ],
      palette,
    );
    expect(layers.get("dm-r1-rail")?.paint?.["line-dasharray"]).toBeUndefined(); // plein
    expect(layers.get("dm-r1-urban")?.paint?.["line-dasharray"]).toBeUndefined(); // plein
    expect(layers.get("dm-r1-air")?.paint?.["line-dasharray"]).toBeDefined(); // pointillés
  });

  it("les tracés sans routeIndex sont traités comme l'itinéraire 1 (rétro-compat)", () => {
    expect(routeColor(undefined)).toBe(ROUTE_COLORS[0]!.core);
    const { map, layers } = fakeMap();
    addRouteOverlay(
      map,
      [{ index: 0, kind: "rail", followsTracks: true, geometry: [[48.8, 2.3], [49.2, 4.0]] }],
      palette,
    );
    expect(layers.get("dm-r1-rail")?.paint?.["line-color"]).toBe("#FF3B30");
  });

  it("removeRouteOverlay supprime toutes les couches de tous les itinéraires", () => {
    const { map, layers, sources } = fakeMap();
    addRouteOverlay(map, traces, palette);
    expect(layers.size).toBeGreaterThan(0);
    removeRouteOverlay(map);
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });

  it("passage à l'itinéraire suivant : addRouteOverlay supprime le tracé de l'itinéraire ABSENT des nouveaux tracés", () => {
    const { map, layers, sources } = fakeMap();
    // Manche 1 terminée : seul l'itinéraire 1 est tracé.
    const tracesRoute1: SegmentTrace[] = [
      { index: 0, kind: "rail", routeIndex: 1, followsTracks: true, geometry: [[48.8, 2.3], [49.2, 4.0]] },
    ];
    addRouteOverlay(map, tracesRoute1, palette);
    expect(layers.get("dm-r1-rail")).toBeDefined();

    // Manche 2 terminée : seuls les tracés de l'itinéraire 2 sont servis —
    // l'itinéraire 1 doit disparaître de la carte (jamais de superposition).
    const tracesRoute2: SegmentTrace[] = [
      { index: 1, kind: "air", routeIndex: 2, followsTracks: true, geometry: [[49.0, 2.5], [48.1, 16.5]] },
    ];
    addRouteOverlay(map, tracesRoute2, palette);
    expect(layers.get("dm-r1-rail")).toBeUndefined();
    expect(sources.get("dm-r1-rail-src")).toBeUndefined();
    expect(layers.get("dm-r2-air")).toBeDefined();
    expect(layers.get("dm-r2-air")?.paint?.["line-color"]).toBe("#34C759");

    // Match terminé : les 3 itinéraires tracés → l'itinéraire 2 disparaît si
    // seuls 1 et 3 sont servis (cas théorique) ; ici les 3 restent.
    addRouteOverlay(map, traces, palette);
    expect(layers.get("dm-r1-rail")).toBeDefined();
    expect(layers.get("dm-r2-air")).toBeDefined();
    expect(layers.get("dm-r3-rail")).toBeDefined();
  });
});
