// Vérifie que le routeur (Transitous/MOTIS) renvoie bien la géométrie réelle
// de chaque leg (legGeometry) — utilisée comme repli du tracé ferroviaire
// quand Overpass est indisponible.
//
//   npm run check:leg-geometry            # Reims → Paris Gare de l'Est, 08:00
//   npm run check:leg-geometry -- "48.8566,2.3522" "50.6292,3.0573"

import { TransitousRouter, parisTimeIso } from "../src/server/routing/transitous.ts";
import { parisDateKey } from "../src/lib/paris-date.ts";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const from = args[0] ?? "49.2583,4.0317"; // Reims
  const to = args[1] ?? "48.8566,2.3522"; // Paris
  const parseLatLng = (s: string): { lat: number; lng: number } => {
    const [lat, lng] = s.split(",").map(Number);
    if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Coordonnée invalide : "${s}" (attendu "lat,lng")`);
    }
    return { lat, lng };
  };
  const { lat: fLat, lng: fLng } = parseLatLng(from);
  const { lat: tLat, lng: tLng } = parseLatLng(to);
  const timeIso = parisTimeIso(parisDateKey(new Date(Date.now() + 86400000)), "08:00");

  const router = new TransitousRouter();
  console.log(`plan ${from} -> ${to} à ${timeIso}…`);
  const itineraries = await router.plan(
    { name: "Départ", lat: fLat, lng: fLng },
    { name: "Arrivée", lat: tLat, lng: tLng },
    timeIso,
    2,
  );
  console.log("itinéraires reçus :", itineraries.length);
  let withGeom = 0;
  let total = 0;
  for (const it of itineraries) {
    for (const leg of it.legs) {
      total++;
      const n = leg.geometry?.length ?? 0;
      if (n >= 2) withGeom++;
      console.log(
        `  leg ${leg.kind.padEnd(10)} ${leg.lineOrCarrier || "-"} ${leg.from} -> ${leg.to} : geometry ${n} points`,
      );
    }
  }
  console.log(`legs avec géométrie réelle : ${withGeom}/${total}`);
  process.exitCode = withGeom > 0 ? 0 : 1;
}

void main();
