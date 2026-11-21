// Vérifie un itinéraire réel entre deux villes (M2) — cas d'usage :
//
//   npm run check:itinerary -- Rennes "Mantes-la-Jolie"
//   npm run check:itinerary -- Rennes "Mantes-la-Jolie" --date 2026-11-23 --time 08:00
//   npm run check:itinerary -- Rennes Vienna          # trajet avec avion
//
// Géocode les deux villes (Transitous), calcule l'itinéraire via le planner
// complet (porte-à-porte GTFS + candidat avion départ→aéroport A → vol A→B →
// aéroport B → arrivée, avec aéroports internationaux les plus proches),
// affiche les segments et exécute la VÉRIFICATION complète (existence de
// chaque leg à son horaire réel + arrêts intermédiaires + optimalité).
// Code de sortie 0 si l'itinéraire est RÉALISTE et OPTIMAL, 1 sinon.

import { getAirports } from "../src/server/dev-journey.ts";
import { planJourney } from "../src/server/routing/planner.ts";
import {
  TransitousRouter,
  parisTimeIso,
  resolveEndpoint,
} from "../src/server/routing/transitous.ts";
import { parisDateKey } from "../src/lib/paris-date.ts";

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--date" && args[i - 1] !== "--time");
  const fromName = positional[0];
  const toName = positional[1];
  if (!fromName || !toName) {
    console.error("Usage : npm run check:itinerary -- <ville départ> <ville arrivée> [--date AAAA-MM-JJ] [--time HH:MM]");
    process.exitCode = 2;
    return;
  }
  const dateIdx = args.indexOf("--date");
  const timeIdx = args.indexOf("--time");
  const dateKey = dateIdx >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(args[dateIdx + 1] ?? "") ? args[dateIdx + 1]! : parisDateKey(new Date(Date.now() + 86400000));
  const hhmm = timeIdx >= 0 && /^\d{2}:\d{2}$/.test(args[timeIdx + 1] ?? "") ? args[timeIdx + 1]! : "08:00";
  const timeIso = parisTimeIso(dateKey, hhmm);

  const router = new TransitousRouter();
  console.log("Géocodage (gare → gare)…");
  // 1er géocodage PLACE pour obtenir des coordonnées de référence (désambiguïsation
  // « Vienna » AT vs Vienna US…), puis résolution gare → gare proche de ces coordonnées.
  const fromRef = await router.geocode(fromName, false);
  const toRef = await router.geocode(toName, false);
  const from = await resolveEndpoint(
    router,
    { name: fromName, lat: fromRef?.lat ?? 0, lng: fromRef?.lng ?? 0 },
    true,
  );
  const to = await resolveEndpoint(
    router,
    { name: toName, lat: toRef?.lat ?? 0, lng: toRef?.lng ?? 0 },
    true,
  );
  if (!from || !to) {
    console.error("Géocodage impossible pour", fromName, "ou", toName);
    process.exitCode = 1;
    return;
  }
  console.log("  départ  :", from.name, from.lat.toFixed(5) + "," + from.lng.toFixed(5));
  console.log("  arrivée :", to.name, to.lat.toFixed(5) + "," + to.lng.toFixed(5));
  console.log("  calcul des itinéraires à", timeIso, "(horaires GTFS réels + candidat avion)…");

  let planned;
  try {
    planned = await planJourney(from, to, {
      router,
      airports: getAirports(),
      dateKey,
      timeIso,
    });
  } catch (err) {
    console.error("❌", (err as Error).message);
    process.exitCode = 1;
    return;
  }

  console.log("\n=== Itinéraire retenu (source : " + planned.source + ", " + planned.candidates + " candidats) ===");
  console.log("durée totale :", planned.journey.totalDurationMin, "min");
  for (const s of planned.journey.segments) {
    if (s.kind === "connection") {
      console.log("   🚶 " + s.modeDetail + "  " + s.from + "  (" + s.durationMin + " min)");
    } else {
      console.log(
        "   " + (s.kind === "rail" ? "🚆" : s.kind === "urban" ? "🚇" : "✈️") + " " +
          s.modeDetail + (s.lineOrCarrier ? " · " + s.lineOrCarrier : "") +
          "  " + s.from + " → " + s.to + "  (" + s.durationMin + " min)" +
          (s.intermediateStops?.length ? "  arrêts: " + s.intermediateStops.slice(0, 8).join(", ") : ""),
      );
    }
  }

  console.log("\n=== Vérification (existence réelle de chaque leg à son horaire + arrêts + optimalité) ===");
  if (planned.verified.ok) {
    console.log("✅ Itinéraire RÉALISTE et OPTIMAL — publiable dans le jeu.");
  } else {
    console.log("❌ Itinéraire REJETÉ :");
    for (const r of planned.verified.reasons) console.log("   - " + r);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
