// Prépare le jeu d'aéroports européens à partir d'OpenFlights (domaine public).
//
//   node scripts/prepare-airports.ts
//
// Sortie : data/airports/airports.europe.json — aéroports de la bbox Europe
// disposant d'un code IATA. Ces données alimentent l'estimation des vols
// au jalon M2 (Amadeus Self-Service étant fermé aux nouveaux comptes, la
// durée de vol est estimée par distance orthodromique, §5.2).

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { downloadText } from "./lib/download.ts";
import { parseCsv } from "./lib/csv.ts";
import { isInEuropeBBox } from "./lib/europe.ts";
import type { AirportRecord } from "../src/lib/geo/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const OPENFLIGHTS_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";

async function main() {
  console.log("Téléchargement d'OpenFlights…");
  const csvText = await downloadText(OPENFLIGHTS_URL);

  // CSV sans en-tête : 0 id, 1 name, 2 city, 3 country, 4 IATA, 5 ICAO,
  // 6 lat, 7 lng, 8 altitude, …, 12 type.
  const airports: AirportRecord[] = [];
  for (const row of parseCsv(csvText, ",")) {
    const type = row[12];
    if (type !== "airport") continue;

    const id = row[0] ?? "";
    const iata = row[4] ?? "";
    if (!id || !iata || iata === "\\N") continue;

    const lat = Number(row[6]);
    const lng = Number(row[7]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isInEuropeBBox(lat, lng)) continue;

    airports.push({
      id,
      name: row[1] ?? "",
      city: row[2] ?? "",
      country: row[3] ?? "",
      iata,
      lat,
      lng,
    });
  }

  mkdirSync(`${ROOT}data/airports/`, { recursive: true });
  writeFileSync(
    `${ROOT}data/airports/airports.europe.json`,
    JSON.stringify(airports),
  );
  console.log(`✅ data/airports/airports.europe.json — ${airports.length} aéroports`);
}

await main();
