// Prépare les jeux de villes à partir de GeoNames (cities5000) enrichis des
// gares voyageurs SNCF pour la France.
//
//   node scripts/prepare-cities.ts
//
// Sorties :
//   data/cities/cities.france.json — villes françaises du périmètre, avec
//       hasTrainStation (gare à ≤ 3 km) ; candidates au départ.
//   data/cities/cities.europe.json  — destinations européennes (hors France,
//       spécification §1.1) ; le snap combine les deux fichiers.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractZip } from "./lib/zip.ts";
import { downloadBytes, downloadText } from "./lib/download.ts";
import { parseCsv } from "./lib/csv.ts";
import { EUROPE_COUNTRY_CODES, isInEuropeBBox } from "./lib/europe.ts";
import { groupArrondissements } from "./lib/arrondissements.ts";
import { haversineKm } from "../src/lib/geo/haversine.ts";
import { encodeGeohash } from "../src/lib/geo/geohash.ts";
import type { CityRecord } from "../src/lib/geo/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const GEONAMES_URL = "https://download.geonames.org/export/dump/cities5000.zip";
const SNCF_GARES_URL =
  "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/csv?use_labels=true";

/** Une gare rattache une ville si elle se trouve à cette distance (km). */
const STATION_MAX_DISTANCE_KM = 3;

interface RawCity {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
  /** Code feature GeoNames (colonne 7) : « PPLX » = section de ville (arrondissement). */
  featureCode?: string;
}

/** TSV GeoNames : colonnes 0 id, 1 name, 4 lat, 5 lng, 7 feature code, 8 country, 14 population. */
function parseGeoNames(tsv: string): RawCity[] {
  const cities: RawCity[] = [];
  for (const line of tsv.split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    const id = cols[0];
    const name = cols[1];
    const lat = Number(cols[4]);
    const lng = Number(cols[5]);
    const featureCode = cols[7] ?? "";
    const country = cols[8] ?? "";
    const population = Number(cols[14]);
    if (!id || !name || !country || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!Number.isFinite(population) || population <= 0) continue;
    if (!isInEuropeBBox(lat, lng)) continue;
    cities.push({ id, name, country, lat, lng, population, featureCode });
  }
  return cities;
}

/** Coordonnées d'une gare depuis l'export CSV SNCF (séparateur « ; »). */
function parseStationPosition(row: string[], posIdx: number): { lat: number; lng: number } | null {
  const combined = `${row[posIdx] ?? ""};${row[posIdx + 1] ?? ""}`;
  const numbers = combined.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  const lat = Number(numbers[0]);
  const lng = Number(numbers[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function loadSncfStations(): Promise<{ lat: number; lng: number }[]> {
  const csvText = await downloadText(SNCF_GARES_URL);
  const rows = parseCsv(csvText, ";");
  if (rows.length === 0) throw new Error("CSV gares SNCF vide");

  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const nameIdx = header.findIndex((h) => /nom.*gare/i.test(h));
  const posIdx = header.findIndex((h) => /position/i.test(h));
  if (posIdx === -1) throw new Error("Colonne « Position géographique » introuvable");

  const stations: { lat: number; lng: number }[] = [];
  for (const row of rows.slice(1)) {
    const station = parseStationPosition(row, posIdx);
    if (station) stations.push(station);
  }
  console.log(`🚉 ${stations.length} gares SNCF chargées (colonne nom #${nameIdx}).`);
  return stations;
}

function toCityRecord(raw: RawCity, hasTrainStation: boolean): CityRecord {
  return {
    id: raw.id,
    name: raw.name,
    country: raw.country,
    lat: raw.lat,
    lng: raw.lng,
    population: raw.population,
    hasTrainStation,
    geohash: encodeGeohash(raw.lat, raw.lng, 6),
  };
}

async function main() {
  console.log("Téléchargement des sources (GeoNames + SNCF Gares de voyageurs)…");

  const zipBytes = await downloadBytes(GEONAMES_URL);
  const files = extractZip(zipBytes);
  const tsvEntry = [...files.keys()].find((name) => name === "cities5000.txt");
  if (!tsvEntry) {
    throw new Error(`cities5000.txt introuvable dans l'archive (${[...files.keys()].join(", ")})`);
  }
  const tsv = files.get(tsvEntry)?.toString("utf8") ?? "";
  console.log(`Archive GeoNames : ${(zipBytes.length / 1_048_576).toFixed(1)} Mo`);

  const parsed = parseGeoNames(tsv);
  const sections = parsed.filter((c) => c.featureCode === "PPLX" || /arrondissement/i.test(c.name));
  const rawCities = groupArrondissements(parsed);
  console.log(
    `🗺️  ${sections.length} sections de ville (arrondissements) regroupées dans leur ville parente`,
  );

  const stations = await loadSncfStations();

  // Enrichit les villes françaises du flag hasTrainStation (gare à ≤ 3 km).
  const franceRaw = rawCities.filter((c) => c.country === "FR");
  const france: CityRecord[] = franceRaw.map((raw) => {
    let hasTrainStation = false;
    for (const station of stations) {
      if (Math.abs(station.lat - raw.lat) > 0.1) continue; // pré-filtre rapide
      if (Math.abs(station.lng - raw.lng) > 0.1) continue;
      if (haversineKm(station.lat, station.lng, raw.lat, raw.lng) <= STATION_MAX_DISTANCE_KM) {
        hasTrainStation = true;
        break;
      }
    }
    return toCityRecord(raw, hasTrainStation);
  });
  const stationCityIds = new Set(
    france.filter((c) => c.hasTrainStation).map((c) => c.id),
  );

  // Les destinations européennes (hors France, §1.1). Le snap côté serveur
  // combine France + Europe pour couvrir aussi les clics en France.
  const europe: CityRecord[] = rawCities
    .filter((c) => c.country !== "FR" && EUROPE_COUNTRY_CODES.has(c.country))
    .map((raw) => toCityRecord(raw, false));

  const byPopulation = (a: CityRecord, b: CityRecord) => b.population - a.population;
  france.sort(byPopulation);
  europe.sort(byPopulation);

  mkdirSync(`${ROOT}/data/cities/`, { recursive: true });
  writeFileSync(`${ROOT}/data/cities/cities.france.json`, JSON.stringify(france));
  writeFileSync(`${ROOT}/data/cities/cities.europe.json`, JSON.stringify(europe));

  const withStation = france.filter((c) => c.hasTrainStation).length;
  console.log(`🚉 ${withStation}/${france.length} villes françaises ont une gare à moins de ${STATION_MAX_DISTANCE_KM} km.`);
  console.log(`✅ data/cities/cities.france.json — ${france.length} villes`);
  console.log(`✅ data/cities/cities.europe.json — ${europe.length} villes`);
  const biggest = europe.find((c) => c.country !== "FR");
  if (biggest) {
    console.log(`   (plus grande destination : ${biggest.name}, ${biggest.country})`);
  }
}

await main();
