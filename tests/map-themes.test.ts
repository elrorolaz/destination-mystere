// Régression du bug « on ne voit plus les villes sur la carte » : le thème de
// fond ne doit JAMAIS modifier les couches propres au jeu (source « dm-cities »
// ou « route-* ») — elles sont stylées par applyGamePalette. Un mock de map
// enregistre tous les appels setPaintProperty / setLayoutProperty.

import { describe, expect, it } from "vitest";
import type { Map as MLMap } from "maplibre-gl";
import {
  MAP_THEMES,
  applyGamePalette,
  applyMapTheme,
  isGameSource,
  type MapThemeId,
} from "../src/components/map/map-themes.ts";

interface Call {
  kind: "paint" | "layout";
  id: string;
  prop: string;
  value: unknown;
}

function fakeMap(layerDefs: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  const map = {
    getStyle: () => ({ layers: layerDefs }),
    setPaintProperty: (id: string, prop: string, value: unknown) => {
      calls.push({ kind: "paint", id, prop, value });
    },
    setLayoutProperty: (id: string, prop: string, value: unknown) => {
      calls.push({ kind: "layout", id, prop, value });
    },
  } as unknown as MLMap;
  return { map, calls };
}

const STYLE_LAYERS = [
  { id: "background", type: "background" },
  { id: "water", type: "fill", source: "osm", "source-layer": "water" },
  { id: "road", type: "line", source: "osm", "source-layer": "road" },
  { id: "place-label", type: "symbol", source: "osm", "source-layer": "place" },
  // --- couches du JEU (ne doivent jamais être touchées par le thème de fond) ---
  { id: "city-halo", type: "circle", source: "dm-cities" },
  { id: "city-station", type: "circle", source: "dm-cities" },
  { id: "city-dot", type: "circle", source: "dm-cities" },
  { id: "label-md", type: "symbol", source: "dm-cities" },
  { id: "route-rail", type: "line", source: "route-rail-src" },
  { id: "route-rail-glow", type: "line", source: "route-rail-src" },
];

describe("map-themes — le thème de fond ne touche jamais les couches du jeu", () => {
  it("isGameSource reconnaît les sources du jeu", () => {
    expect(isGameSource("dm-cities")).toBe(true);
    expect(isGameSource("route-rail-src")).toBe(true);
    expect(isGameSource("route-air-mid-src")).toBe(true);
    expect(isGameSource("osm")).toBe(false);
    expect(isGameSource(undefined)).toBe(false);
  });

  it("pour chacun des 6 thèmes, aucune couche du jeu n'est modifiée", () => {
    for (const theme of MAP_THEMES) {
      const { map, calls } = fakeMap(STYLE_LAYERS);
      applyMapTheme(map, theme.id as MapThemeId);
      const touchedGame = calls.filter((c) => isGameSource((STYLE_LAYERS.find((l) => l.id === c.id) as { source?: string })?.source));
      expect(touchedGame, `thème ${theme.id}`).toEqual([]);
      // et le fond de base est bien recoloré
      expect(calls.some((c) => c.id === "background" && c.prop === "background-color")).toBe(true);
    }
  });

  it("applyGamePalette applique la palette du thème sur les villes et étiquettes", () => {
    for (const theme of MAP_THEMES) {
      const { map, calls } = fakeMap(STYLE_LAYERS);
      applyGamePalette(map, theme.id as MapThemeId);
      const dot = calls.find((c) => c.id === "city-dot" && c.prop === "circle-color");
      const label = calls.find((c) => c.id === "label-md" && c.prop === "text-color");
      expect(dot?.value).toBe(theme.palette.dot);
      expect(label?.value).toBe(theme.palette.label);
    }
  });

  it("deux thèmes retenus : A « nuit » (dark) et D « jour » (light)", () => {
    expect(MAP_THEMES.map((t) => t.id).sort()).toEqual(["jour", "nuit"]);
    const light = MAP_THEMES.filter((t) => t.mode === "light");
    expect(light.map((t) => t.id)).toEqual(["jour"]);
    const dark = MAP_THEMES.filter((t) => t.mode === "dark");
    expect(dark.map((t) => t.id)).toEqual(["nuit"]);
    for (const t of MAP_THEMES) {
      // tracé très marqué : couleur saturée, différente du fond
      expect(t.palette.routeRail).not.toBe(t.swatch);
    }
  });
});
