// Prépare les données embarquées de la maquette Canvas (démo jouable) :
//  - décode countries-110m.json (TopoJSON) en GeoJSON, filtre l'Europe,
//    arrondit les coordonnées à 2 décimales ;
//  - extrait des villes GeoNames celles de ≥ 25 000 habitants, en tableaux
//    compacts [nom, pays, lat, lng, population].
// Sortie : data/tmp/demo-borders.json et data/tmp/demo-cities.json (tailles
// affichées — la contrainte de la maquette est d'embarquer < ~300 Ko au total).

import { readFileSync, writeFileSync } from "node:fs";

type TopoTopology = {
  type: "Topology";
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][];
  objects: Record<
    string,
    { type: string; geometries: Array<TopoGeometryObject> }
  >;
};

type TopoGeometryObject = {
  type: "Polygon" | "MultiPolygon" | "LineString" | "Point";
  id?: string | number;
  properties?: { name?: string };
  arcs: unknown;
};

const ROOT = new URL("..", import.meta.url);

// Pays dessinés sur la carte de la maquette (Europe géographique utile au jeu
// + voisins pour le contexte visuel).
const COUNTRY_NAMES = new Set([
  "France", "Germany", "Netherlands", "Belgium", "Luxembourg", "Switzerland",
  "Austria", "Spain", "Portugal", "Italy", "Slovenia", "Croatia",
  "Bosnia and Herz.", "Bosnia and Herzegovina", "Serbia", "Kosovo",
  "Montenegro", "Albania", "North Macedonia", "Macedonia", "Greece",
  "Bulgaria", "Romania", "Moldova", "Ukraine", "Hungary", "Slovakia",
  "Czechia", "Czech Republic", "Poland", "Lithuania", "Latvia", "Estonia",
  "Belarus", "Finland", "Sweden", "Norway", "Denmark", "Ireland",
  "United Kingdom", "Iceland", "Turkey", "Cyprus", "Malta", "Russia",
  "Morocco", "Algeria", "Tunisia", "Andorra", "Monaco",
]);

function decodeArcs(topo: TopoTopology): number[][][] {
  const { transform } = topo;
  const points: number[][][] = [];
  let dx = 0;
  let dy = 0;
  for (const arc of topo.arcs) {
    const arcPoints: number[][] = [];
    dx = 0;
    dy = 0;
    for (let i = 0; i < arc.length; i += 2) {
      // Quantification TopoJSON : delta-encodage, transform inverse.
      dx += arc[i] ?? 0;
      dy += arc[i + 1] ?? 0;
      arcPoints.push([
        (transform?.scale[0] ?? 1) * dx + (transform?.translate[0] ?? 0),
        (transform?.scale[1] ?? 1) * dy + (transform?.translate[1] ?? 0),
      ]);
    }
    points.push(arcPoints);
  }
  return points;
}

function ringFromArcIndexes(
  indexes: number[],
  arcs: number[][][],
): number[][] {
  const ring: number[][] = [];
  for (const idx of indexes) {
    const arc = (idx >= 0 ? arcs[idx] : arcs[~idx]) ?? [];
    const reversed = idx < 0;
    const start = ring.length === 0 ? 0 : 1;
    for (let i = start; i < arc.length; i++) {
      const p = arc[reversed ? arc.length - 1 - i : i];
      if (p) ring.push(p);
    }
  }
  return ring;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function roundRing(ring: number[][]): number[][] {
  return ring.map((p) => [round2(p[0] ?? 0), round2(p[1] ?? 0)]);
}

const topo = JSON.parse(
  readFileSync(new URL("data/tmp/countries-110m.json", ROOT), "utf-8"),
) as TopoTopology;
const arcs = decodeArcs(topo);

type Feature = { name: string; rings: number[][][] };
const features: Feature[] = [];

const geometries = topo.objects["countries"]?.geometries ?? [];
for (const geom of geometries) {
  const name = geom.properties?.name ?? "";
  if (!COUNTRY_NAMES.has(name)) continue;

  const polygons: number[][][] = [];
  if (geom.type === "Polygon") {
    const rings = geom.arcs as number[][];
    for (const ringIdx of rings) polygons.push(ringFromArcIndexes(ringIdx, arcs));
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.arcs as number[][][]) {
      for (const ringIdx of poly) {
        polygons.push(ringFromArcIndexes(ringIdx, arcs));
      }
    }
  }
  features.push({ name, rings: polygons.map(roundRing) });
}

writeFileSync(
  new URL("data/tmp/demo-borders.json", ROOT),
  JSON.stringify(features),
);

// --- Villes ---------------------------------------------------------------

type CityRecord = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
  hasTrainStation: boolean;
};

const MIN_POP = 25_000;

function loadCities(file: string): CityRecord[] {
  return JSON.parse(
    readFileSync(new URL(`data/cities/${file}`, ROOT), "utf-8"),
  ) as CityRecord[];
}

const byId = new Map<string, CityRecord>();
for (const city of [
  ...loadCities("cities.france.json"),
  ...loadCities("cities.europe.json"),
]) {
  const prev = byId.get(city.id);
  if (!prev || (!prev.hasTrainStation && city.hasTrainStation)) {
    byId.set(city.id, city);
  }
}

const compact: Array<[string, string, number, number, number]> = [];
for (const city of byId.values()) {
  if (city.population < MIN_POP) continue;
  compact.push([
    city.name,
    city.country,
    Math.round(city.lat * 10000) / 10000,
    Math.round(city.lng * 10000) / 10000,
    city.population,
  ]);
}
compact.sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0));

writeFileSync(
  new URL("data/tmp/demo-cities.json", ROOT),
  JSON.stringify(compact),
);

const kb = (path: string) =>
  (
    readFileSync(new URL(`data/tmp/${path}`, ROOT)).length / 1024
  ).toFixed(1);

console.log(`Frontières : ${features.length} pays — ${kb("demo-borders.json")} Ko`);
console.log(
  `Villes ≥ ${MIN_POP.toLocaleString("fr-FR")} hab. : ${compact.length} — ${kb("demo-cities.json")} Ko`,
);
