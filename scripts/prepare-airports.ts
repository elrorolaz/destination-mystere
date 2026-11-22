// Prépare le jeu d'aéroports européens à partir d'OurAirports (domaine public).
//
//   node scripts/prepare-airports.ts
//
// Sortie : data/airports/airports.europe.json — AÉROPORTS INTERNATIONAUX
// UNIQUEMENT (type OurAirports « large_airport » avec service régulier) de la
// bbox Europe, avec code IATA. Ce sont les seuls aéroports utilisés pour les
// trajets en avion du jeu (M2) : un vol ne relie jamais un petit aérodrome
// régional (Albert-Bray, Cognac…), ce qui posait des itinéraires fictifs.
//
// Chaque aéroport est annoté de :
//   - countryCode (ISO 2 lettres, champ iso_country) — compagnie aérienne
//     choisie selon le pays, logique « par pays » ;
//   - hubPopulation : population de la plus grande ville à ≤ 45 km, calculée
//     depuis data/cities/*.json quand les fichiers sont présents.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { downloadText } from "./lib/download.ts";
import { parseCsv } from "./lib/csv.ts";
import { isInEuropeBBox } from "./lib/europe.ts";
import { haversineKm } from "../src/lib/geo/haversine.ts";
import type { AirportRecord, CityRecord } from "../src/lib/geo/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// OurAirports (plus à jour qu'OpenFlights sur le classement large/medium/small
// et le service régulier) : https://ourairports.com/data/airports.csv
const OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";

/**
 * Aéroports internationaux MAJEURS uniquement : « large_airport » avec
 * service régulier, plus les « medium_airport » à service régulier dont le
 * hub (plus grande ville à ≤ 45 km) fait ≥ 500 000 hab. (Cagliari, etc.).
 * Les petits aérodromes régionaux (Albert-Bray, Cognac…) — même avec IATA et
 * service régulier — restent exclus : un vol du jeu ne part jamais d'un
 * aérodrome minuscule.
 */
const INTERNATIONAL_TYPES = new Set(["large_airport", "medium_airport"]);
const SCHEDULED = "yes";
/** Rayon de rattachement d'une ville à son « hub » aéroportuaire (km). */
const HUB_RADIUS_KM = 45;
/** Un medium_airport n'est retenu que si son hub fait au moins ce seuil. */
const MEDIUM_MIN_HUB_POPULATION = 500_000;

/** Villes préparées (si présentes) pour calculer le hubPopulation. */
function loadPreparedCities(): CityRecord[] {
  const cities: CityRecord[] = [];
  for (const file of ["cities.europe.json", "cities.france.json"]) {
    const p = `${ROOT}data/cities/${file}`;
    if (!existsSync(p)) continue;
    for (const c of JSON.parse(readFileSync(p, "utf8")) as CityRecord[]) {
      cities.push(c);
    }
  }
  return cities;
}

/** Plus grande ville à ≤ 45 km de l'aéroport (hub) : population + nom. */
function hubOf(
  lat: number,
  lng: number,
  cities: readonly CityRecord[],
): { population: number; name: string } | undefined {
  let hub: { population: number; name: string } | undefined;
  for (const c of cities) {
    if (haversineKm(c.lat, c.lng, lat, lng) <= HUB_RADIUS_KM && (!hub || c.population > hub.population)) {
      hub = { population: c.population, name: c.name };
    }
  }
  return hub && hub.population > 0 ? hub : undefined;
}

async function main() {
  console.log("Téléchargement d'OurAirports (airports.csv)…");
  const csvText = await downloadText(OURAIRPORTS_URL);
  const rows = parseCsv(csvText, ",");
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const cId = col("id");
  const cType = col("type");
  const cName = col("name");
  const cLat = col("latitude_deg");
  const cLng = col("longitude_deg");
  const cCountry = col("iso_country");
  const cMunicipality = col("municipality");
  const cScheduled = col("scheduled_service");
  const cIata = col("iata_code");
  if (cIata < 0 || cType < 0) throw new Error("Format airports.csv inattendu");

  const cities = loadPreparedCities();
  console.log(`   ${cities.length} villes préparées trouvées pour les hubs.`);

  const airports: AirportRecord[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const type = row[cType] ?? "";
    const scheduled = row[cScheduled] ?? "";
    const iata = (row[cIata] ?? "").trim();
    // Aéroports internationaux uniquement (correction M2) : un vol du jeu ne
    // part/arrive jamais d'un aérodrome régional ou sans service régulier.
    if (!INTERNATIONAL_TYPES.has(type) || scheduled !== SCHEDULED || !iata) {
      skipped++;
      continue;
    }
    const lat = Number(row[cLat]);
    const lng = Number(row[cLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isInEuropeBBox(lat, lng)) continue;

    const countryCode = (row[cCountry] ?? "").trim();
    // « Paris (Roissy-en-France, Val-d'Oise) » → « Paris » (nom de ville propre)
    const city = (row[cMunicipality] ?? "").split(/[,(]/)[0]?.trim() ?? "";
    const hub = hubOf(lat, lng, cities);
    // Un medium_airport n'est retenu que s'il dessert un hub majeur.
    if (type === "medium_airport" && (hub?.population ?? 0) < MEDIUM_MIN_HUB_POPULATION) {
      skipped++;
      continue;
    }
    airports.push({
      id: row[cId] ?? iata,
      name: row[cName] ?? "",
      city,
      country: countryCode, // OurAirports fournit directement l'ISO2
      countryCode,
      iata,
      lat,
      lng,
      type,
      hubPopulation: hub?.population,
      hubCity: hub?.name,
    });
  }

  mkdirSync(`${ROOT}data/airports/`, { recursive: true });
  writeFileSync(
    `${ROOT}data/airports/airports.europe.json`,
    JSON.stringify(airports),
  );
  const countries = new Set(airports.map((a) => a.countryCode));
  console.log(
    `✅ data/airports/airports.europe.json — ${airports.length} aéroports internationaux ` +
      `(${skipped} aérodromes non internationaux ignorés), ${countries.size} pays couverts`,
  );
}

await main();
