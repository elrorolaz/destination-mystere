"use client";

// Carte de jeu (M3) : Europe au départ, zoom jusqu'au niveau d'une ville et de
// ses banlieues (maxZoom 16). Couches « constellation » de villes servies par
// /api/cities selon le zoom, épingles de propositions, épingles origine et
// destination, tracés de fin de partie sur voies ferrées.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, LayerSpecification, Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CityMapPoint, PublicCityInfo, PublicGuess, SegmentTrace } from "@/lib/game-types";
import { addRouteOverlay } from "./RouteOverlay";
import { createGuessMarker } from "./GuessPin";

const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://tiles.openfreemap.org/styles/liberty";

export interface GameMapProps {
  origin: PublicCityInfo | null;
  destination: PublicCityInfo | null; // fin de partie uniquement
  guesses: PublicGuess[];
  active: boolean;
  traces: SegmentTrace[];
  onGuess?: (lat: number, lng: number) => void;
}

/* ---------- Thème nuit : surcouche sombre par-dessus le style de base ---------- */

function applyNightTheme(map: MLMap): void {
  let style: { layers?: Array<Record<string, unknown>> } | undefined;
  try {
    style = map.getStyle() as { layers?: Array<Record<string, unknown>> };
  } catch {
    return;
  }
  if (!style || !style.layers) return;
  for (const layer of style.layers) {
    const id = String(layer.id);
    const type = String(layer.type);
    const sourceLayer = layer["source-layer"];
    try {
      if (type === "background") {
        map.setPaintProperty(id, "background-color", "#0B1023");
      } else if (type === "fill") {
        if (sourceLayer === "water") {
          map.setPaintProperty(id, "fill-color", "#101C3A");
        } else if (sourceLayer === "building") {
          map.setPaintProperty(id, "fill-color", "#131D40");
        }
      } else if (type === "symbol") {
        // Les labels de lieux du style de base sont masqués : la couche
        // « constellation » affiche ses propres noms de villes.
        if (sourceLayer === "place") {
          map.setLayoutProperty(id, "visibility", "none");
        } else {
          map.setPaintProperty(id, "text-color", "#A9B4D0");
          map.setPaintProperty(id, "text-halo-color", "#0B1023");
        }
      }
    } catch {
      // Propriété inadaptée pour cette couche : on ignore.
    }
  }
}

/* ---------- Villes visibles (couche constellation) ---------- */

function minPopulationForZoom(zoom: number): number {
  if (zoom < 4.5) return 250000;
  if (zoom < 6.5) return 80000;
  if (zoom < 8.5) return 20000;
  return 5000;
}

function cityToFeature(city: CityMapPoint): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {
      name: city.name,
      population: city.population,
      hasTrainStation: city.hasTrainStation,
    },
    geometry: { type: "Point", coordinates: [city.lng, city.lat] },
  };
}

async function loadVisibleCities(map: MLMap): Promise<void> {
  const source = map.getSource("dm-cities");
  if (!source) return;
  const bounds = map.getBounds();
  const params = new URLSearchParams({
    minLat: bounds.getSouth().toFixed(4),
    maxLat: bounds.getNorth().toFixed(4),
    minLng: bounds.getWest().toFixed(4),
    maxLng: bounds.getEast().toFixed(4),
    minPopulation: String(minPopulationForZoom(map.getZoom())),
  });
  try {
    const res = await fetch("/api/cities?" + params.toString());
    if (!res.ok) return;
    const json = (await res.json()) as { cities?: CityMapPoint[] };
    (source as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (json.cities ?? []).map(cityToFeature),
    });
  } catch {
    // Réseau indisponible : on garde l'ensemble de villes précédent.
  }
}

function addCityLayers(map: MLMap): void {
  if (map.getSource("dm-cities")) return;
  map.addSource("dm-cities", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "city-halo",
    type: "circle",
    source: "dm-cities",
    paint: { "circle-radius": 5, "circle-color": "rgba(232, 180, 74, 0.13)" },
  } as unknown as LayerSpecification);

  map.addLayer({
    id: "city-station",
    type: "circle",
    source: "dm-cities",
    filter: ["==", ["get", "hasTrainStation"], true],
    paint: {
      "circle-radius": 6,
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#E8B44A",
    },
  } as unknown as LayerSpecification);

  map.addLayer({
    id: "city-dot",
    type: "circle",
    source: "dm-cities",
    paint: {
      "circle-radius": 2,
      "circle-color": "#E6ECFF",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#0B1023",
    },
  } as unknown as LayerSpecification);

  // Labels par paliers : capitales d'abord, jusqu'aux petites villes.
  const tiers = [
    { id: "label-xl", minzoom: 3, filter: [">=", ["get", "population"], 750000], size: 13 },
    { id: "label-lg", minzoom: 5, filter: [">=", ["get", "population"], 200000], size: 12 },
    { id: "label-md", minzoom: 7.2, filter: [">=", ["get", "population"], 25000], size: 11 },
    { id: "label-sm", minzoom: 9.5, filter: ["<", ["get", "population"], 25000], size: 10 },
  ];
  for (const tier of tiers) {
    map.addLayer({
      id: tier.id,
      type: "symbol",
      source: "dm-cities",
      minzoom: tier.minzoom,
      filter: tier.filter,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": tier.size,
        "text-anchor": "top",
        "text-offset": [0, 0.8],
      },
      paint: {
        "text-color": "#E6ECFF",
        "text-halo-color": "#0B1023",
        "text-halo-width": 1.3,
      },
    } as unknown as LayerSpecification);
  }
}

/* ---------- Tracés de fin de partie ---------- */

function fitBoundsToTraces(map: MLMap, traces: SegmentTrace[]): void {
  let has = false;
  const bounds = new maplibregl.LngLatBounds();
  for (const trace of traces) {
    for (const p of trace.geometry) {
      bounds.extend([p[1], p[0]]);
      has = true;
    }
  }
  if (!has) return;
  map.fitBounds(bounds, { padding: 90, maxZoom: 8.5, duration: 1500 });
}

/* ---------- Composant ---------- */

export default function GameMap(props: GameMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const clickRef = useRef(props);
  clickRef.current = props;
  const [loadTick, setLoadTick] = useState(0);
  const originMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const guessMarkersRef = useRef<Marker[]>([]);
  const guessCountRef = useRef(-1);

  // Initialisation : une seule instance de carte, réinstanciée proprement
  // par le nettoyage (double montage en mode strict couvert par loadTick).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [9.5, 49.5], // Europe
      zoom: 3.4,
      minZoom: 3,
      maxZoom: 16, // jusqu'au niveau ville / banlieue
    });
    mapRef.current = map;

    map.on("styledata", () => applyNightTheme(map));
    map.on("load", () => {
      addCityLayers(map);
      void loadVisibleCities(map);
      setLoadTick((t) => t + 1);
    });

    let cityTimer: ReturnType<typeof setTimeout> | null = null;
    map.on("moveend", () => {
      if (cityTimer) clearTimeout(cityTimer);
      // Debounce : pas de rafale de requêtes pendant les manipulations.
      cityTimer = setTimeout(() => {
        void loadVisibleCities(map);
      }, 250);
    });

    map.on("click", (e) => {
      const current = clickRef.current;
      if (current.active && current.onGuess) {
        current.onGuess(e.lngLat.lat, e.lngLat.lng);
      }
    });

    map.on("error", (e) => {
      console.error("MapLibre :", e && e.error);
    });

    return () => {
      if (cityTimer) clearTimeout(cityTimer);
      map.remove();
      mapRef.current = null;
      originMarkerRef.current = null;
      destMarkerRef.current = null;
      guessMarkersRef.current = [];
      guessCountRef.current = -1;
    };
  }, []);

  // Curseur : viseur pendant la partie active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0) return;
    map.getCanvas().style.cursor = props.active ? "crosshair" : "";
  }, [props.active, loadTick]);

  // Épingle du point de départ (or, pulsation).
  useEffect(() => {
    const map = mapRef.current;
    const origin = props.origin;
    if (!map || loadTick === 0 || !origin || originMarkerRef.current) return;
    const wrap = document.createElement("div");
    wrap.className = "dm-origin-pin-wrap";
    wrap.title = "Départ : " + origin.name;
    const pulse = document.createElement("div");
    pulse.className = "dm-origin-pulse";
    const core = document.createElement("div");
    core.className = "dm-origin-core";
    wrap.appendChild(pulse);
    wrap.appendChild(core);
    originMarkerRef.current = new maplibregl.Marker({ element: wrap })
      .setLngLat([origin.lng, origin.lat])
      .addTo(map);
  }, [props.origin, loadTick]);

  // Épingle de la destination (vert) : n'apparaît qu'en fin de partie.
  useEffect(() => {
    const map = mapRef.current;
    const dest = props.destination;
    if (!map || loadTick === 0 || !dest || destMarkerRef.current) return;
    const el = document.createElement("div");
    el.className = "dm-dest-pin";
    el.title = "Destination : " + dest.name;
    destMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([dest.lng, dest.lat])
      .addTo(map);
  }, [props.destination, loadTick]);

  // Épingles des propositions (numérotées).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0) return;
    if (guessCountRef.current === props.guesses.length) return;
    guessCountRef.current = props.guesses.length;
    for (const marker of guessMarkersRef.current) {
      marker.remove();
    }
    guessMarkersRef.current = props.guesses.map((g, i) =>
      new maplibregl.Marker({ element: createGuessMarker(i + 1, g.correct) })
        .setLngLat([g.city.lng, g.city.lat])
        .addTo(map),
    );
  }, [props.guesses, loadTick]);

  // Tracés de fin de partie : voies ferrées + arc aérien, puis cadrage.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0 || props.traces.length === 0) return;
    addRouteOverlay(map, props.traces);
    fitBoundsToTraces(map, props.traces);
  }, [props.traces, loadTick]);

  return (
    <div
      className="dm-map"
      ref={containerRef}
      role="application"
      aria-label="Carte de l'Europe : cliquez une ville pour proposer"
    />
  );
}
