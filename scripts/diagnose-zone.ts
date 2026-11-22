// Diagnostic : pourquoi n'obtient-on que des itinéraires en France ?
//
//   npm run diagnose:zone
//
// 1. Compte les villes FR / Europe en base et les références de clusters.
// 2. Pour 12 dates, tire la paire déterministe (avec filtre isRef) et affiche
//    la zone, la paire et la distance.
// 3. Pour une paire EU, tente la planification réelle et affiche le verdict.

import { getCitiesCache } from "../src/server/cities.ts";
import { getMajorAirports } from "../src/server/dev-journey.ts";
import { selectCityPair } from "../src/server/daily-challenge.ts";
import { planJourney } from "../src/server/routing/planner.ts";
import { defaultRouter } from "../src/server/routing/router.ts";
import { resolveEndpoint } from "../src/server/routing/transitous.ts";
import { haversineKm } from "../src/lib/geo/haversine.ts";

async function main() {
  const cache = await getCitiesCache();
  if (!cache) {
    console.error("Aucune ville en base.");
    process.exitCode = 1;
    return;
  }
  const { cities, clusters } = cache;
  const fr = cities.filter((c) => c.country === "FR");
  const eu = cities.filter((c) => c.country !== "FR");
  const frRefs = fr.filter((c) => clusters.isRef(c.id));
  const euRefs = eu.filter((c) => clusters.isRef(c.id));
  console.log(`villes: ${cities.length} total = ${fr.length} FR + ${eu.length} Europe`);
  console.log(`références de clusters: ${clusters.refCount()} = ${frRefs.length} FR + ${euRefs.length} Europe`);
  const euDests = euRefs.filter((c) => c.population >= 50_000);
  console.log(`destinations EU potentielles (ref, pop ≥ 50k): ${euDests.length}`);

  const dates: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, 10, 23 + i)); // à partir du 2026-11-23
    dates.push(d.toISOString().slice(0, 10));
  }
  let nbFR = 0;
  let nbEU = 0;
  for (const dateKey of dates) {
    const pair = selectCityPair(cities, dateKey, 0, { isRef: (id) => clusters.isRef(id) });
    if (!pair) {
      console.log(`${dateKey}: AUCUNE PAIRE`);
      continue;
    }
    const km = Math.round(haversineKm(pair.origin.lat, pair.origin.lng, pair.dest.lat, pair.dest.lng));
    if (pair.zone === "FR") nbFR++;
    else nbEU++;
    console.log(
      `${dateKey}: zone=${pair.zone}  ${pair.origin.name} → ${pair.dest.name} (${pair.dest.country})  ${km} km`,
    );
  }
  console.log(`\nSur 12 dates: ${nbFR} FR, ${nbEU} EU`);

  // Tente une planification réelle sur les 3 premières paires EU trouvées.
  let tested = 0;
  for (const dateKey of dates) {
    const pair = selectCityPair(cities, dateKey, 0, { isRef: (id) => clusters.isRef(id) });
    if (!pair || pair.zone !== "EU") continue;
    tested++;
    console.log(`\nPlanification réelle ${pair.origin.name} → ${pair.dest.name} (${dateKey})…`);
    const router = defaultRouter();
    const airports = await getMajorAirports();
    console.log(`aéroports majeurs disponibles: ${airports.length}`);
    try {
      const originEp = { ...(await resolveEndpoint(router, pair.origin, true)), country: pair.origin.country };
      const destEp = { ...(await resolveEndpoint(router, pair.dest, pair.dest.hasTrainStation)), country: pair.dest.country };
      // Diagnostic des accès aéroportuaires (candidat avion).
      const { majorAirportFor } = await import("../src/server/routing/flights.ts");
      const fromA = majorAirportFor(originEp, airports, 200);
      const toA = majorAirportFor(destEp, airports, 300);
      console.log(`  aéroports majeurs: départ=${fromA?.iata ?? "null"} arrivée=${toA?.iata ?? "null"}`);
      if (fromA) {
        const acc1 = await router.plan(originEp, { name: fromA.iata, lat: fromA.lat, lng: fromA.lng }, "2026-11-23T07:00:00Z", 3);
        console.log(`  accès départ→${fromA.iata}: ${acc1.length} itinéraires, durées=${acc1.map((i) => i.durationMin).join(",") || "—"}`);
      }
      if (toA) {
        const acc2 = await router.plan({ name: toA.iata, lat: toA.lat, lng: toA.lng }, destEp, "2026-11-23T07:00:00Z", 3);
        console.log(`  accès ${toA.iata}→arrivée: ${acc2.length} itinéraires, durées=${acc2.map((i) => i.durationMin).join(",") || "—"}`);
      }
      const planned = await planJourney(originEp, destEp, { router, airports, dateKey });
      console.log(`verifié: ${planned.verified.ok}  raisons: ${planned.verified.reasons.join("; ") || "—"}`);
      console.log(`segments: ${planned.journey.segments.length}, durée ${planned.journey.totalDurationMin} min`);
      for (const s of planned.journey.segments) {
        console.log(`  ${s.index}. ${s.kind} ${s.from} → ${s.to} [${s.lineOrCarrier}] ${s.durationMin} min`);
      }
    } catch (e) {
      console.log(`ERREUR planification: ${(e as Error).message}`);
    }
    if (tested >= 3) break;
  }
}

void main();
