// Deux fonds de carte retenus (design) — mode NUIT et mode JOUR, appliqués par
// surcouche sur le style vectoriel OpenFreeMap. Le choix est persisté en
// localStorage ; à défaut, la préférence système du navigateur décide
// (prefers-color-scheme).
//
//   A « Nuit étoilée » (mode nuit)  — fond très sombre, détails à peine
//      visibles ; fort contraste pour les épingles.
//   D « Jour papier »   (mode jour)  — fond clair façon papier cassé, eau bleu
//      pastel, routes grises discrètes.
//
// Chaque thème porte aussi une « palette de jeu » : couleurs des couches
// propres au jeu (points de villes, étiquettes, tracé final). Les couches du
// style de base qui appartiennent au jeu (sources « dm-cities », « route-* »)
// ne sont JAMAIS modifiées par le thème de fond : elles sont stylées séparément
// par applyGamePalette (sinon les villes deviendraient invisibles — bug corrigé).

import type { Map as MLMap } from "maplibre-gl";

export type MapThemeId = "nuit" | "jour";

export type MapThemeMode = "dark" | "light";

/** Couleurs des éléments du jeu (constellation, étiquettes, tracé final). */
export interface GamePalette {
  dot: string;
  dotStroke: string;
  halo: string;
  station: string;
  label: string;
  labelHalo: string;
  routeRail: string;
  routeRailGlow: string;
  routeUrban: string;
  routeUrbanGlow: string;
  routeAir: string;
  routeAirGlow: string;
  routeConn: string;
  airIcon: string;
}

export interface MapThemeDef {
  id: MapThemeId;
  label: string;
  swatch: string;
  description: string;
  mode: MapThemeMode;
  palette: GamePalette;
}

/* ---------- Palettes de jeu ---------- */

const PALETTE_DARK: GamePalette = {
  dot: "#E6ECFF",
  dotStroke: "#0B1023",
  halo: "rgba(232, 180, 74, 0.16)",
  station: "#E8B44A",
  label: "#E6ECFF",
  labelHalo: "#0B1023",
  // Tracé final TRÈS marqué sur fond sombre : rose vif + halo.
  routeRail: "#FF2D55",
  routeRailGlow: "#FF2D55",
  routeUrban: "#FF7A3D",
  routeUrbanGlow: "#FF7A3D",
  routeAir: "#B388FF",
  routeAirGlow: "#7C4DFF",
  routeConn: "#A9B4D0",
  airIcon: "#D7C4FF",
};

const PALETTE_LIGHT: GamePalette = {
  dot: "#1F2937",
  dotStroke: "#FFFFFF",
  halo: "rgba(217, 119, 6, 0.18)",
  station: "#D97706",
  label: "#111827",
  labelHalo: "#FFFFFF",
  // Tracé final TRÈS marqué sur fond clair : rouge vermillon + halo.
  routeRail: "#D50000",
  routeRailGlow: "#FF1744",
  routeUrban: "#E65100",
  routeUrbanGlow: "#FF9800",
  routeAir: "#6A1B9A",
  routeAirGlow: "#9C27B0",
  routeConn: "#6B7280",
  airIcon: "#6A1B9A",
};

export const MAP_THEMES: readonly MapThemeDef[] = [
  {
    id: "nuit",
    label: "A · Nuit étoilée",
    swatch: "#0b1023",
    description: "Mode nuit : fond très sombre, détails à peine visibles — fort contraste pour les épingles.",
    mode: "dark",
    palette: PALETTE_DARK,
  },
  {
    id: "jour",
    label: "D · Jour papier",
    swatch: "#f7f5f0",
    description: "Mode jour : fond clair façon papier cassé, eau bleu pastel, routes grises discrètes.",
    mode: "light",
    palette: PALETTE_LIGHT,
  },
] as const;

export function getThemeDef(id: MapThemeId): MapThemeDef {
  return MAP_THEMES.find((t) => t.id === id) ?? MAP_THEMES[0]!;
}

const STORAGE_KEY = "dm-map-theme";

/**
 * Thème mémorisé ; à défaut, la préférence système (prefers-color-scheme :
 * light → mode jour « D », sinon mode nuit « A »). Côté serveur (SSR), on
 * retombe sur le mode nuit.
 */
export function getStoredMapTheme(): MapThemeId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "nuit" || raw === "jour") return raw;
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "jour" : "nuit";
    }
  } catch {
    // localStorage indisponible : thème par défaut.
  }
  return "nuit";
}

export function storeMapTheme(id: MapThemeId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // sans persistance : le thème reste pour la session courante.
  }
}

/* ---------- Application du thème de fond ---------- */

interface StyleLayer {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
}

/** Sources propres au jeu : jamais modifiées par le thème de fond. */
export function isGameSource(source: string | undefined): boolean {
  if (!source) return false;
  return source === "dm-cities" || source.startsWith("route-");
}

function layersOf(map: MLMap): StyleLayer[] {
  try {
    const style = map.getStyle() as { layers?: StyleLayer[] } | undefined;
    return style?.layers ?? [];
  } catch {
    return [];
  }
}

function setPaint(map: MLMap, id: string, prop: string, value: unknown): void {
  // MapLibre v5 ne throw PAS sur une couche inexistante : il fire un event
  // « error » (« Cannot style non-existing layer ... ») — à éviter absolument.
  if (!map.getLayer(id)) return;
  try {
    map.setPaintProperty(id, prop, value as never);
  } catch {
    // style pas encore chargé (_checkLoaded) ou propriété inadaptée : on ignore
  }
}

function setLayout(map: MLMap, id: string, prop: string, value: unknown): void {
  if (!map.getLayer(id)) return; // idem : pas de « Cannot style non-existing layer »
  try {
    map.setLayoutProperty(id, prop, value as never);
  } catch {
    // idem
  }
}

/** Thème A — « Nuit étoilée » (mode nuit). */
function applyNuit(map: MLMap): void {
  for (const layer of layersOf(map)) {
    if (isGameSource(layer.source)) continue;
    const sl = layer["source-layer"] ?? "";
    if (layer.type === "background") {
      setPaint(map, layer.id, "background-color", "#0B1023");
    } else if (layer.type === "fill" || layer.type === "fill-extrusion") {
      if (sl === "water") setPaint(map, layer.id, "fill-color", "#101C3A");
      else if (sl === "building") setPaint(map, layer.id, "fill-color", "#131D40");
      else setPaint(map, layer.id, "fill-color", "#0D1730");
    } else if (layer.type === "line") {
      setPaint(map, layer.id, "line-color", "#1E2A4D");
      setPaint(map, layer.id, "line-opacity", 0.55);
    } else if (layer.type === "hillshade" || layer.type === "raster") {
      setLayout(map, layer.id, "visibility", "none");
    } else if (layer.type === "symbol") {
      if (sl === "place") setLayout(map, layer.id, "visibility", "none");
      else {
        setPaint(map, layer.id, "text-color", "#A9B4D0");
        setPaint(map, layer.id, "text-halo-color", "#0B1023");
      }
    }
  }
}

/** Thème D — « Jour papier » (mode jour) : fond clair façon papier, eau pastel. */
function applyJour(map: MLMap): void {
  for (const layer of layersOf(map)) {
    if (isGameSource(layer.source)) continue;
    const sl = layer["source-layer"] ?? "";
    if (layer.type === "background") {
      setPaint(map, layer.id, "background-color", "#F7F5F0");
    } else if (layer.type === "fill" || layer.type === "fill-extrusion") {
      if (sl === "water") setPaint(map, layer.id, "fill-color", "#BFD7E8");
      else if (sl === "building") setPaint(map, layer.id, "fill-color", "#ECE8DE");
      else if (sl === "park" || sl === "landuse" || sl === "landcover") setPaint(map, layer.id, "fill-color", "#EFECE3");
      else setPaint(map, layer.id, "fill-color", "#F1EEE6");
    } else if (layer.type === "line") {
      if (sl === "boundary") {
        setPaint(map, layer.id, "line-color", "#B8B2A2");
        setPaint(map, layer.id, "line-opacity", 1);
      } else if (sl === "waterway" || sl === "coastline") {
        setPaint(map, layer.id, "line-color", "#A9C6DA");
        setPaint(map, layer.id, "line-opacity", 0.9);
      } else {
        setPaint(map, layer.id, "line-color", "#D9D4C6");
        setPaint(map, layer.id, "line-opacity", 0.9);
      }
    } else if (layer.type === "hillshade" || layer.type === "raster") {
      setLayout(map, layer.id, "visibility", "none");
    } else if (layer.type === "symbol") {
      if (sl === "place") setLayout(map, layer.id, "visibility", "none");
      else {
        setPaint(map, layer.id, "text-color", "#6B7280");
        setPaint(map, layer.id, "text-halo-color", "#F7F5F0");
      }
    }
  }
}

/** Applique le thème de fond sur toutes les couches du style (jamais celles du jeu). */
export function applyMapTheme(map: MLMap, theme: MapThemeId): void {
  if (theme === "jour") applyJour(map);
  else applyNuit(map);
}

/* ---------- Palette des éléments du jeu ---------- */

const LABEL_LAYER_IDS = ["label-xl", "label-lg", "label-md", "label-sm"];

/**
 * Applique la palette du thème aux couches PROPRES AU JEU (constellation de
 * villes + étiquettes). Appelée au chargement et à chaque changement de thème.
 */
export function applyGamePalette(map: MLMap, theme: MapThemeId): void {
  const p = getThemeDef(theme).palette;
  setPaint(map, "city-halo", "circle-color", p.halo);
  setPaint(map, "city-station", "circle-stroke-color", p.station);
  setPaint(map, "city-dot", "circle-color", p.dot);
  setPaint(map, "city-dot", "circle-stroke-color", p.dotStroke);
  for (const id of LABEL_LAYER_IDS) {
    setPaint(map, id, "text-color", p.label);
    setPaint(map, id, "text-halo-color", p.labelHalo);
  }
}
