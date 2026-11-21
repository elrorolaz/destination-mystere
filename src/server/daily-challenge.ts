// Génération quotidienne du défi (M2, spécification §6) :
//   1. sélection DÉTERMINISTE du duo de villes — PRNG seedé par la clé de
//      date AAAA-MM-JJ (Europe/Paris) : même duo pour tous, rejouable (§6.2) ;
//   2. planification de l'itinéraire (planner.ts : API SNCF/Navitia si
//      SNCF_API_TOKEN est renseigné, sinon estimation paramétrique ; vols
//      estimés par distance orthodromique §5.2) ;
//   3. stockage dans DailyChallenge (upsert, une ligne par date).
//
// La zone de destination est tirée à 50/50 France / Europe (décision produit :
// « pas un avion à chaque trajet » — la spec §1.1 disait hors France, la
// maquette v5 et le choix produit généralisent à la France).

import { Prisma } from "@prisma/client";
import { db } from "../lib/db.ts";
import { haversineKm } from "../lib/geo/haversine.ts";
import type { CityRecord } from "../lib/geo/types.ts";
import { getCitiesCache } from "./cities.ts";
import { getMajorAirports } from "./dev-journey.ts";
import { pick, prngFromDateKey } from "./prng.ts";
import { planJourney } from "./routing/planner.ts";
import { defaultRouter, type Router } from "./routing/router.ts";
import { resolveEndpoint } from "./routing/transitous.ts";
import type { DailyJourney, Journey } from "./routing/types.ts";

/** Bornes de distance du tirage (km orthodromiques). */
export const MIN_KM_FR = 100;
export const MAX_KM_FR = 900;
export const MIN_KM_EU = 400;
export const MAX_KM_EU = 1800;
/** Populations minimales : départ avec gare, destination devinable. */
export const MIN_POP_ORIGIN = 20000;
export const MIN_POP_DEST_FR = 30000;
export const MIN_POP_DEST_EU = 50000;

export type ChallengeZone = "FR" | "EU";

export interface CityPair {
  origin: CityRecord;
  dest: CityRecord;
  zone: ChallengeZone;
}

/**
 * Sélection déterministe du duo (fonction PURE, testée) : PRNG seedé par la
 * date → mêmes villes pour tous les joueurs, reproductible à l'identique.
 * `attempt` fait avancer la séquence de tirages (réessais vérifiés, M2).
 * Contraintes : départ français avec gare, bornes de distance selon la zone.
 */
export function selectCityPair(
  cities: readonly CityRecord[],
  dateKey: string,
  attempt = 0,
): CityPair | null {
  const rng = prngFromDateKey(attempt === 0 ? dateKey : dateKey + "#" + attempt);
  const origins = cities.filter(
    (c) => c.country === "FR" && c.hasTrainStation && c.population >= MIN_POP_ORIGIN,
  );
  if (origins.length === 0) return null;
  const zone: ChallengeZone = rng() < 0.5 ? "FR" : "EU";
  const dests =
    zone === "FR"
      ? cities.filter((c) => c.country === "FR" && c.population >= MIN_POP_DEST_FR)
      : cities.filter((c) => c.country !== "FR" && c.population >= MIN_POP_DEST_EU);
  if (dests.length === 0) return null;

  const minKm = zone === "FR" ? MIN_KM_FR : MIN_KM_EU;
  const maxKm = zone === "FR" ? MAX_KM_FR : MAX_KM_EU;
  for (let attempt = 0; attempt < 200; attempt++) {
    const origin = pick(rng, origins);
    const dest = pick(rng, dests);
    if (!origin || !dest || dest.id === origin.id) continue;
    const km = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    if (km < minKm || km > maxKm) continue;
    return { origin, dest, zone };
  }
  return null;
}

export interface GeneratedChallenge extends DailyJourney {
  /** Source des tronçons : « transitous » / « navitia », toujours « +verified ». */
  source: string;
  zone: ChallengeZone;
  /** Motifs de rejet des paires précédentes (vide si la 1ʳᵉ passe). */
  rejected: string[];
}

export interface GenerateOptions {
  /** Nombre max de paires seedées à essayer (chacune doit être vérifiée). */
  maxPairs?: number;
  router?: Router;
}

/**
 * Génère (sans stocker) le défi d'une date : paires déterministes (seed =
 * date) essayées dans l'ordre, itinéraire calculé par le routeur RÉEL puis
 * VÉRIFIÉ (existence + optimalité, verify.ts) ; la première paire vérifiée
 * gagne. Lance une erreur sinon — le cron bascule alors sur le repli (fixture).
 */
export async function generateDailyChallenge(
  dateKey: string,
  opts: GenerateOptions = {},
): Promise<GeneratedChallenge> {
  const cache = await getCitiesCache();
  if (!cache) {
    throw new Error("Aucune ville en base : npm run prepare:data && npm run data:import");
  }
  const airports = await getMajorAirports();
  const maxPairs = opts.maxPairs ?? 5;
  const rejected: string[] = [];

  const router = opts.router ?? defaultRouter();
  for (let attempt = 0; attempt < maxPairs; attempt++) {
    const pair = selectCityPair(cache.cities, dateKey, attempt);
    if (!pair) break;
    const label = pair.origin.name + " → " + pair.dest.name;
    try {
      // Planification gare → gare : l'origine a toujours une gare (§1.1),
      // la destination quand elle en a une ; sinon centre-ville.
      // Le pays est transmis : un trajet France → France reste 100 % rail
      // (le candidat avion n'est construit que si les pays diffèrent).
      const originEp = { ...(await resolveEndpoint(router, pair.origin, true)), country: pair.origin.country };
      const destEp = { ...(await resolveEndpoint(router, pair.dest, pair.dest.hasTrainStation)), country: pair.dest.country };
      const planned = await planJourney(originEp, destEp, {
        router,
        airports,
        dateKey,
      });
      if (!planned.verified.ok) {
        rejected.push(label + " : non vérifié (" + planned.verified.reasons.join("; ") + ")");
        continue;
      }
      return {
        challengeDate: dateKey,
        originCityId: pair.origin.id,
        destCityId: pair.dest.id,
        totalDurationMin: planned.journey.totalDurationMin,
        segments: planned.journey.segments,
        source: planned.source + "+verified",
        zone: pair.zone,
        rejected,
      };
    } catch (err) {
      rejected.push(label + " : " + (err as Error).message);
    }
  }
  throw new Error(
    "Aucune paire vérifiée pour " + dateKey + " (" + maxPairs + " essais) : " + rejected.join(" | "),
  );
}

/** Upsert du défi en base (une ligne par date, §6.4). */
export async function upsertDailyChallenge(
  challenge: DailyJourney,
  date: Date,
): Promise<void> {
  const journeyPayload = {
    totalDurationMin: challenge.totalDurationMin,
    segments: challenge.segments,
  } as unknown as Prisma.InputJsonValue;
  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: {
      challengeDate: date,
      originCityId: challenge.originCityId,
      destCityId: challenge.destCityId,
      journey: journeyPayload,
      totalDurationMin: challenge.totalDurationMin,
    },
    update: {
      originCityId: challenge.originCityId,
      destCityId: challenge.destCityId,
      journey: journeyPayload,
      totalDurationMin: challenge.totalDurationMin,
    },
  });
}

/** Le journey tel que stocké (pour tests / debug). */
export function journeyOf(challenge: DailyJourney): Journey {
  return { totalDurationMin: challenge.totalDurationMin, segments: challenge.segments };
}
