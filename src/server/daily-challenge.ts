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
/** Europe 100 % train (sans avion) : trajets atteignables en rail. */
export const MIN_KM_EU_TRAIN = 250;
export const MAX_KM_EU_TRAIN = 1000;
/** Europe avec avion : assez loin pour justifier un vol. */
export const MIN_KM_EU_AIR = 600;
export const MAX_KM_EU = 1800;
/** Probabilité d'un itinéraire SANS avion (100 % terrestre) : 40 %. */
export const NO_AIR_PROBABILITY = 0.4;
/** Populations minimales : départ avec gare, destination devinable. */
export const MIN_POP_ORIGIN = 20000;
export const MIN_POP_DEST_FR = 30000;
export const MIN_POP_DEST_EU = 50000;

export type ChallengeZone = "FR" | "EU";

export interface CityPair {
  origin: CityRecord;
  dest: CityRecord;
  zone: ChallengeZone;
  /** false = itinéraire 100 % terrestre (le planner n'envisage pas l'avion). */
  allowAir: boolean;
}

export interface SelectPairOptions {
  /** Restreint aux villes de référence de cluster (affichées/cliquables). */
  isRef?: (cityId: string) => boolean;
  /** Force la zone (réessais d'une même date : on reste dans la zone tirée). */
  forceZone?: ChallengeZone;
  /** Force allowAir (réessais : on garde le mode avion/terrestre tiré). */
  forceAllowAir?: boolean;
  /**
   * Paires « originId>destId » déjà prises par un autre itinéraire du même
   * jour : jamais réutilisées (les 3 itinéraires du jour sont distincts).
   */
  exclude?: ReadonlySet<string>;
}

/**
 * Sélection déterministe du duo (fonction PURE, testée) : PRNG seedé par la
 * date → mêmes villes pour tous les joueurs, reproductible à l'identique.
 * `attempt` fait avancer la séquence de tirages (réessais vérifiés, M2).
 *
 * Tirage : 40 % d'itinéraires SANS avion (NO_AIR_PROBABILITY) — zone FR ou
 * Europe proche en train ; sinon Europe avec avion (assez loin). Départ
 * français avec gare, bornes de distance selon la zone. `opts.isRef`
 * (design clusters) restreint aux villes de référence de cluster : seules
 * elles sont affichées et cliquables sur la carte.
 */
export function selectCityPair(
  cities: readonly CityRecord[],
  dateKey: string,
  attempt = 0,
  opts: SelectPairOptions = {},
): CityPair | null {
  const onlyRefs = (c: CityRecord): boolean => !opts.isRef || opts.isRef(c.id);
  const rng = prngFromDateKey(attempt === 0 ? dateKey : dateKey + "#" + attempt);
  const origins = cities.filter(
    (c) => c.country === "FR" && c.hasTrainStation && c.population >= MIN_POP_ORIGIN && onlyRefs(c),
  );
  if (origins.length === 0) return null;

  const noAir = rng() < NO_AIR_PROBABILITY; // 40 % sans avion
  const zone: ChallengeZone = opts.forceZone ?? (noAir ? (rng() < 0.5 ? "FR" : "EU") : "EU");
  // Jamais de vol France → France ; avec avion uniquement en zone EU tirée « avec avion ».
  const allowAir = zone === "FR" ? false : (opts.forceAllowAir ?? !noAir);

  const dests =
    zone === "FR"
      ? cities.filter((c) => c.country === "FR" && c.population >= MIN_POP_DEST_FR && onlyRefs(c))
      : cities.filter((c) => c.country !== "FR" && c.population >= MIN_POP_DEST_EU && onlyRefs(c));
  if (dests.length === 0) return null;

  const minKm = zone === "FR" ? MIN_KM_FR : allowAir ? MIN_KM_EU_AIR : MIN_KM_EU_TRAIN;
  const maxKm = zone === "FR" ? MAX_KM_FR : allowAir ? MAX_KM_EU : MAX_KM_EU_TRAIN;
  for (let attempt = 0; attempt < 200; attempt++) {
    const origin = pick(rng, origins);
    const dest = pick(rng, dests);
    if (!origin || !dest || dest.id === origin.id) continue;
    if (opts.exclude?.has(origin.id + ">" + dest.id)) continue;
    const km = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    if (km < minKm || km > maxKm) continue;
    return { origin, dest, zone, allowAir };
  }
  return null;
}

export interface GeneratedChallenge extends DailyJourney {
  /** Source des tronçons : « transitous » / « navitia », toujours « +verified ». */
  source: string;
  zone: ChallengeZone;
  /** false = itinéraire 100 % terrestre (40 % des tirages, NO_AIR_PROBABILITY). */
  allowAir: boolean;
  /** Slot de l'itinéraire dans la journée (1..ROUTE_COUNT). */
  routeIndex: number;
  /** Motifs de rejet des paires précédentes (vide si la 1ʳᵉ passe). */
  rejected: string[];
}

export interface GenerateOptions {
  /** Nombre max de paires seedées à essayer (chacune doit être vérifiée). */
  maxPairs?: number;
  router?: Router;
  /**
   * Slot de l'itinéraire dans la journée (1..ROUTE_COUNT) : la graine du PRNG
   * devient « date#r<slot> » pour slot > 1, afin que chaque itinéraire du jour
   * soit déterministe ET distinct des autres.
   */
  slot?: number;
  /** Paires déjà prises par les autres itinéraires du même jour. */
  exclude?: ReadonlySet<string>;
}

/**
 * Génère (sans stocker) le défi d'une date : paires déterministes (seed =
 * date, ou date#r<slot> pour les itinéraires suivants) essayées dans l'ordre,
 * itinéraire calculé par le routeur RÉEL puis VÉRIFIÉ (existence + optimalité,
 * verify.ts) ; la première paire vérifiée gagne. Lance une erreur sinon —
 * l'appelant bascule alors sur le repli (fixture).
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
  const maxPairs = opts.maxPairs ?? 10;
  const rejected: string[] = [];
  const slot = opts.slot ?? 1;
  // Graine par itinéraire : slot 1 garde la seed « date » historique, les
  // suivants prennent « date#r<slot> » (déterministe, distinct).
  const seedKey = slot > 1 ? dateKey + "#r" + slot : dateKey;

  const router = opts.router ?? defaultRouter();
  // Zone et mode avion tirés au premier essai, puis FORCÉS pour les réessais :
  // si la date tire « Europe », on essaie jusqu'à maxPairs paires EU (sinon un
  // rejet de planification ferait retomber systématiquement sur du France).
  let firstZone: ChallengeZone | null = null;
  let firstAllowAir: boolean | null = null;
  for (let attempt = 0; attempt < maxPairs; attempt++) {
    const pair = selectCityPair(cache.cities, seedKey, attempt, {
      isRef: (id) => cache.clusters.isRef(id),
      forceZone: firstZone ?? undefined,
      forceAllowAir: firstAllowAir ?? undefined,
      exclude: opts.exclude,
    });
    if (!pair) break;
    if (firstZone === null) {
      firstZone = pair.zone;
      firstAllowAir = pair.allowAir;
    }
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
        allowAir: pair.allowAir,
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
        allowAir: pair.allowAir,
        routeIndex: slot,
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

/**
 * Upsert d'un itinéraire du jour en base : une ligne DailyRoute par
 * (date, routeIndex), la ligne DailyChallenge (calendrier) étant créée au
 * besoin (§6.4).
 */
export async function upsertDailyRoute(
  challenge: DailyJourney & { routeIndex?: number },
  date: Date,
): Promise<void> {
  const routeIndex = challenge.routeIndex ?? 1;
  const journeyPayload = {
    totalDurationMin: challenge.totalDurationMin,
    segments: challenge.segments,
  } as unknown as Prisma.InputJsonValue;
  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: { challengeDate: date },
    update: {},
  });
  await db.dailyRoute.upsert({
    where: { challengeDate_routeIndex: { challengeDate: date, routeIndex } },
    create: {
      challengeDate: date,
      routeIndex,
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
