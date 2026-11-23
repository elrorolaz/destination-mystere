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
import { addRouteOverlay, removeRouteOverlay } from "./RouteOverlay";
import { createGuessMarker } from "./GuessPin";
import { applyMapTheme, applyGamePalette, getThemeDef, type MapThemeId } from "./map-themes";

const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://tiles.openfreemap.org/styles/liberty";

export interface GameMapProps {
  origin: PublicCityInfo | null;
  destination: PublicCityInfo | null; // fin de partie uniquement
  guesses: PublicGuess[];
  active: boolean;
  traces: SegmentTrace[];
  onGuess?: (lat: number, lng: number) => void;
  /**
   * Incrémenté à chaque nouvelle partie (reroll 🎲) : la carte est remise à
   * zéro (épingles de propositions, épingle destination, tracés, origine).
   */
  resetKey: number;
  /** Fond de carte choisi (design) : thème appliqué par surcouche. */
  mapTheme: MapThemeId;
}

/* ---------- Villes visibles (couche constellation) ---------- */

// Design : les villes intermédiaires apparaissent tôt — dès le zoom 4 on voit
// les villes ≥ 200 000 hab, puis 60 000 à zoom 5.5, 15 000 à zoom 7, et
// toutes les villes ≥ 5 000 hab ensuite.
function minPopulationForZoom(zoom: number): number {
  if (zoom < 4) return 200000;
  if (zoom < 5.5) return 60000;
  if (zoom < 7) return 15000;
  return 5000;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
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

  // Labels par paliers : les villes intermédiaires étiquetées tôt (design) —
  // grandes villes dès le zoom 3, villes moyennes dès ~5.6, petites dès ~7.2.
  const tiers = [
    { id: "label-xl", minzoom: 3, filter: [">=", ["get", "population"], 500000], size: 13 },
    { id: "label-lg", minzoom: 4.2, filter: [">=", ["get", "population"], 120000], size: 12 },
    { id: "label-md", minzoom: 5.6, filter: [">=", ["get", "population"], 30000], size: 11 },
    { id: "label-sm", minzoom: 7.2, filter: ["<", ["get", "population"], 30000], size: 10 },
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
  const originNameRef = useRef<string | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const guessMarkersRef = useRef<Marker[]>([]);
  const guessCountRef = useRef(-1);
  const lastResetKeyRef = useRef(0);
  const themeRef = useRef<MapThemeId>(props.mapTheme);
  themeRef.current = props.mapTheme;
  const confirmPopupRef = useRef<maplibregl.Popup | null>(null);
  const snapReqRef = useRef(0);

  // Le thème peut changer en cours de partie (sélecteur A–F) : on applique
  // aussitôt le fond + la palette des éléments du jeu, et on les réapplique à
  // chaque « styledata » (le style peut être rechangé par MapLibre).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0) return;
    applyMapTheme(map, props.mapTheme);
    applyGamePalette(map, props.mapTheme);
  }, [props.mapTheme, loadTick]);

  const closeConfirmPopup = (): void => {
    snapReqRef.current += 1; // invalide une éventuelle requête /api/snap en vol
    if (confirmPopupRef.current) {
      confirmPopupRef.current.remove();
      confirmPopupRef.current = null;
    }
  };

  /**
   * Clic carte → popup de confirmation (design) : on snappe le point côté
   * serveur (endpoint public, aucune donnée de partie) pour afficher le nom
   * de la ville visée, puis le joueur confirme ou annule. La validation
   * définitive reste faite par POST /api/guess avec les coordonnées du clic.
   */
  const openConfirmPopup = (map: MLMap, lat: number, lng: number): void => {
    closeConfirmPopup();
    const reqId = snapReqRef.current;

    const el = document.createElement("div");
    el.className = "dm-confirm";
    el.innerHTML =
      '<p class="dm-confirm-title">Proposer ce point ?</p>' +
      '<p class="dm-confirm-sub">Rattachement en cours…</p>' +
      '<div class="dm-confirm-actions">' +
      '<button type="button" class="dm-btn dm-btn-primary dm-confirm-ok">Valider</button>' +
      '<button type="button" class="dm-btn dm-confirm-cancel">Annuler</button>' +
      "</div>";

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", className: "dm-confirm-popup" })
      .setLngLat([lng, lat])
      .setDOMContent(el)
      .addTo(map);
    confirmPopupRef.current = popup;
    popup.on("close", () => {
      if (confirmPopupRef.current === popup) confirmPopupRef.current = null;
    });

    const okBtn = el.querySelector<HTMLButtonElement>(".dm-confirm-ok");
    const cancelBtn = el.querySelector<HTMLButtonElement>(".dm-confirm-cancel");
    cancelBtn?.addEventListener("click", () => closeConfirmPopup());
    okBtn?.addEventListener("click", () => {
      const current = clickRef.current;
      closeConfirmPopup();
      if (current.active && current.onGuess) current.onGuess(lat, lng);
    });

    // Snap public pour nommer la ville visée dans la popup.
    void (async () => {
      try {
        const res = await fetch(`/api/snap?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          snap?: { name: string; country: string; distanceKm: number };
        };
        if (reqId !== snapReqRef.current || !json.snap) return; // popup remplacée entre-temps
        const sub = el.querySelector(".dm-confirm-sub");
        const title = el.querySelector(".dm-confirm-title");
        if (sub) {
          sub.innerHTML =
            "Ville visée : <strong>" +
            escapeHtml(json.snap.name) +
            "</strong> (" +
            escapeHtml(json.snap.country) +
            ") · clic à " +
            json.snap.distanceKm.toFixed(1) +
            " km du centre";
        }
        if (title) title.innerHTML = "Proposer <strong>" + escapeHtml(json.snap.name) + "</strong> ?";
      } catch {
        // snap indisponible : la popup garde « Proposer ce point ? » générique
      }
    })();
  };

  // Nouvelle partie (reroll) : on efface tout ce qui appartient à l'ancienne —
  // épingle destination, épingles de propositions, tracés d'itinéraire et
  // épingle d'origine (recréée ensuite avec la nouvelle ville de départ).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0) return;
    if (props.resetKey === lastResetKeyRef.current) return;
    lastResetKeyRef.current = props.resetKey;
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    for (const marker of guessMarkersRef.current) {
      marker.remove();
    }
    guessMarkersRef.current = [];
    guessCountRef.current = -1;
    removeRouteOverlay(map);
    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
      originNameRef.current = null;
    }
    closeConfirmPopup();
  }, [props.resetKey, loadTick]);

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

    map.on("styledata", () => {
      applyMapTheme(map, themeRef.current);
      // « styledata » fire aussi AVANT « load » : les couches du jeu
      // (city-*, label-*) n'existent pas encore — applyGamePalette les ignore
      // tant qu'elles n'ont pas été créées par addCityLayers.
      if (map.getLayer("city-dot")) applyGamePalette(map, themeRef.current);
    });
    map.on("load", () => {
      addCityLayers(map);
      applyMapTheme(map, themeRef.current);
      applyGamePalette(map, themeRef.current);
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

    // Clic = demande de confirmation (design) : popup « Proposer X ? »
    // avec Valider / Annuler — la proposition n'est envoyée qu'au clic sur
    // « Valider » (elle appelle alors onGuess avec les coordonnées du clic).
    map.on("click", (e) => {
      const current = clickRef.current;
      if (current.active && current.onGuess) {
        openConfirmPopup(map, e.lngLat.lat, e.lngLat.lng);
      }
    });

    map.on("error", (e) => {
      console.error("MapLibre :", e && e.error);
    });

    return () => {
      if (cityTimer) clearTimeout(cityTimer);
      if (confirmPopupRef.current) {
        confirmPopupRef.current.remove();
        confirmPopupRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      originMarkerRef.current = null;
      destMarkerRef.current = null;
      guessMarkersRef.current = [];
      guessCountRef.current = -1;
    };
  }, []);

  // Curseur : viseur pendant la partie active. En fin de partie (active
  // false), on ferme aussi la popup de confirmation encore ouverte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0) return;
    map.getCanvas().style.cursor = props.active ? "crosshair" : "";
    if (!props.active) closeConfirmPopup();
  }, [props.active, loadTick]);

  // Épingle du point de départ (or, pulsation) — recréée si l'origine change.
  useEffect(() => {
    const map = mapRef.current;
    const origin = props.origin;
    if (!map || loadTick === 0 || !origin) return;
    if (originMarkerRef.current && originNameRef.current === origin.name) return;
    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }
    originNameRef.current = origin.name;
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

  // Épingle de la destination (vert) : n'apparaît qu'en fin de partie et
  // disparaît si la partie est remise à zéro (reroll).
  useEffect(() => {
    const map = mapRef.current;
    const dest = props.destination;
    if (!map || loadTick === 0) return;
    if (!dest) {
      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }
      return;
    }
    if (destMarkerRef.current) return;
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
  // Les couleurs viennent de la palette du thème courant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadTick === 0 || props.traces.length === 0) return;
    addRouteOverlay(map, props.traces, getThemeDef(themeRef.current).palette);
    fitBoundsToTraces(map, props.traces);
  }, [props.traces, loadTick, props.mapTheme]);

  return (
    <div
      className="dm-map"
      data-map-theme={getThemeDef(props.mapTheme).mode}
      ref={containerRef}
      role="application"
      aria-label="Carte de l'Europe : cliquez une ville pour proposer"
    />
  );
}
