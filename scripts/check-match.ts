// Vérification de bout en bout du match en 3 itinéraires (sans serveur HTTP) :
// génération (route 1 + fond 2/3), état public, manches via submitGuess,
// passage au suivant via nextRoute, anti-fuite des destinations, résultat final.
//
//   DEV_FIXTURE=true npx tsx scripts/check-match.ts
//
// Crée une session de test (guestKey jetable) dans la base de dev.

import { db } from "../src/lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../src/lib/paris-date.ts";
import { ensureTodayRoute1, getTodayRoutes } from "../src/server/challenge-store.ts";
import { getPublicState, nextRoute, submitGuess } from "../src/server/game-service.ts";
import { ROUTE_COUNT } from "../src/lib/game-types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const guest = "check-match-" + Date.now();
  const dateKey = parisDateKey();
  const date = challengeDateFromKey(dateKey);

  // 1) Itinéraire 1 servi tout de suite, 2 et 3 générés en fond.
  const r1 = await ensureTodayRoute1();
  if (!r1) throw new Error("aucun itinéraire 1 généré");
  console.log("✅ itinéraire 1 :", r1.originCity.name, "→", r1.destinationCity.name);

  // Attendre que le fond ait produit les 3 itinéraires (max 90 s).
  let routes = await getTodayRoutes();
  for (let i = 0; i < 90 && routes.length < ROUTE_COUNT; i++) {
    await sleep(1000);
    routes = await getTodayRoutes();
  }
  console.log(
    "✅ itinéraires du jour :",
    routes.map((r) => `#${r.routeIndex} ${r.originCity.name}→${r.destinationCity.name}`).join("  |  "),
  );
  if (routes.length < ROUTE_COUNT) throw new Error("génération en fond incomplète");
  const paires = new Set(routes.map((r) => r.originCityId + ">" + r.destCityId));
  console.log(paires.size === routes.length ? "✅ paires distinctes" : "⚠️ paires dupliquées (repli)");

  // 2) État public initial + anti-fuite.
  let state = await getPublicState(guest);
  console.log(
    "✅ état initial : route",
    state.routeIndex + "/" + state.routeCount,
    "status", state.status,
    "total", state.totalScore,
    "manches", state.routeResults.map((r) => r.status).join(","),
  );
  const nomsDest = routes.map((r) => r.destinationCity.name);
  const fuiteInitiale = nomsDest.filter((n) => JSON.stringify(state).includes(n));
  console.log(fuiteInitiale.length === 0 ? "✅ anti-fuite OK (aucune destination en clair)" : "❌ FUITE: " + fuiteInitiale);

  // 3) Jouer les 3 manches (victoire au 1er essai en visant la destination lue en base).
  for (let manche = 1; manche <= ROUTE_COUNT; manche++) {
    const route = await db.dailyRoute.findUnique({
      where: { challengeDate_routeIndex: { challengeDate: date, routeIndex: state.routeIndex } },
      include: { destinationCity: true },
    });
    if (!route) throw new Error("route courante introuvable");
    const dest = route.destinationCity;
    await sleep(950); // rate limit ~1 req/s
    state = await submitGuess(guest, dest.lat, dest.lng);
    console.log(
      `✅ manche ${manche} : status=${state.status} score=${state.score} total=${state.totalScore} dest=${state.destination?.name} matchFinished=${state.matchFinished}`,
    );
    // Anti-fuite : les manches non terminées ne doivent pas révéler leur destination.
    const json = JSON.stringify(state);
    const nonTerminees = state.routeResults.filter((r) => r.status === "PENDING" || r.status === "ACTIVE");
    for (const r of nonTerminees) {
      const routeN = routes.find((x) => x.routeIndex === r.index)!;
      if (json.includes(routeN.destinationCity.name)) {
        throw new Error("❌ FUITE destination manche " + r.index + " : " + routeN.destinationCity.name);
      }
    }
    console.log("   anti-fuite manches non terminées : OK");
    if (manche < ROUTE_COUNT) {
      state = await nextRoute(guest);
      console.log(
        `✅ nextRoute → itinéraire ${state.routeIndex}/${state.routeCount} status=${state.status} départ=${state.origin.name} total=${state.totalScore}`,
      );
    }
  }

  // 4) Résultat final.
  console.log("✅ matchFinished =", state.matchFinished, "— score final =", state.totalScore);
  for (const r of state.routeResults) {
    console.log(
      `   #${r.index} ${r.origin?.name}→${r.destination?.name}  status=${r.status} score=${r.score} lastDistanceKm=${r.lastDistanceKm}`,
    );
  }
  if (!state.matchFinished) throw new Error("match non terminé après 3 manches");
  if (state.totalScore !== state.routeResults.reduce((a, r) => a + r.score, 0)) {
    throw new Error("totalScore incohérent");
  }
  console.log("🎉 flux match 3 itinéraires OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
