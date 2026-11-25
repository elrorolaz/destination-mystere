// Service de jeu : toute la vérité reste ici (§2, §7). Le client ne reçoit
// jamais la destination ni le « journey » d'une manche avant sa fin ; les
// indices sont servis selon le nombre d'essais réellement enregistré.
//
// Un MATCH du jour = ROUTE_COUNT itinéraires (3) joués l'un après l'autre.
// GameSession = le match (currentRouteIndex, totalScore) ; RouteSession = une
// manche (un itinéraire) ; Guess = une proposition de la manche courante.

import { db } from "../lib/db.ts";
import { haversineKm } from "../lib/geo/haversine.ts";
import { parisDateKey, challengeDateFromKey } from "../lib/paris-date.ts";
import type {
  PublicChallengeState,
  PublicGuess,
  PublicRouteResult,
  PublicStatus,
} from "../lib/game-types.ts";
import { ROUTE_COUNT } from "../lib/game-types.ts";
import {
  ensureTodayRoutes,
  getRoute,
  type RouteWithCities,
} from "./challenge-store.ts";
import { getSnapper } from "./cities.ts";
import { unlockedHints } from "./hints.ts";
import { MAX_ATTEMPTS, proximityScore, standardScore } from "./scoring.ts";
import type { Journey } from "./routing/types.ts";

export class GameError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Match du jour d'un invité, identifié par son cookie httpOnly (M3 ; M4 : comptes). */
export async function getOrCreateSession(guestKey: string) {
  const challengeDate = challengeDateFromKey(parisDateKey());
  const existing = await db.gameSession.findUnique({
    where: { guestKey_challengeDate: { guestKey, challengeDate } },
  });
  if (existing) return existing;
  try {
    return await db.gameSession.create({
      data: { guestKey, challengeDate, status: "ACTIVE" },
    });
  } catch {
    // Concurrence : une autre requête a créé la session entre-temps.
    const raced = await db.gameSession.findUnique({
      where: { guestKey_challengeDate: { guestKey, challengeDate } },
    });
    if (!raced) throw new GameError("Impossible de créer la session", 500);
    return raced;
  }
}

/** Manche (itinéraire) `routeIndex` du match, créée à la première entrée. */
async function getOrCreateRouteSession(sessionId: string, routeIndex: number) {
  const existing = await db.routeSession.findUnique({
    where: { sessionId_routeIndex: { sessionId, routeIndex } },
  });
  if (existing) return existing;
  try {
    return await db.routeSession.create({
      data: { sessionId, routeIndex, status: "ACTIVE" },
    });
  } catch {
    const raced = await db.routeSession.findUnique({
      where: { sessionId_routeIndex: { sessionId, routeIndex } },
    });
    if (!raced) throw new GameError("Impossible de créer la manche", 500);
    return raced;
  }
}

export interface CityCore {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
}

export interface ChallengeInput {
  journey: Journey;
  totalDurationMin: number;
  originCity: CityCore;
  destinationCity: CityCore;
  originCityId: string;
  destCityId: string;
}

export interface GuessInput {
  attemptNumber: number;
  snappedCity: CityCore;
  correct: boolean;
}

/** Réduction de RouteWithCities (Prisma) vers l'entrée pure du builder. */
export function toRouteInput(route: RouteWithCities): ChallengeInput & { routeIndex: number } {
  return {
    routeIndex: route.routeIndex,
    journey: route.journey as unknown as Journey,
    totalDurationMin: route.totalDurationMin,
    originCity: route.originCity,
    destinationCity: route.destinationCity,
    originCityId: route.originCityId,
    destCityId: route.destCityId,
  };
}

/** Entrée d'une manche du match pour buildPublicState (données serveur seules). */
export interface MatchRouteInput {
  /** 1..ROUTE_COUNT. */
  index: number;
  /** Itinéraire du jour (null si pas encore généré → manche PENDING). */
  route: (ChallengeInput & { routeIndex: number }) | null;
  /** Manche jouée (null = pas encore commencée). */
  session: { status: string; attemptCount: number; score: number } | null;
  /** Propositions de cette manche. */
  guesses: GuessInput[];
}

function toPublicCity(c: CityCore) {
  return { name: c.name, country: c.country, lat: c.lat, lng: c.lng };
}

/**
 * État public du match — fonction PURE, testée (§7) : pour chaque manche,
 * la destination et le journey ne sont projetés qu'en fin de manche ; les
 * manches non terminées ne révèlent que leur statut (PENDING/ACTIVE).
 * `routes` fait exactement ROUTE_COUNT entrées (index 1..3) ; la manche
 * courante est `routes[currentRouteIndex - 1]`.
 */
export function buildPublicState(
  dateKey: string,
  routes: readonly MatchRouteInput[],
  currentRouteIndex: number,
): PublicChallengeState {
  const routeResults: PublicRouteResult[] = routes.map((r) => {
    if (!r.session) {
      return {
        index: r.index,
        status: "PENDING",
        attemptCount: 0,
        score: 0,
        origin: null,
        destination: null,
        lastDistanceKm: null,
      };
    }
    const finished = r.session.status !== "ACTIVE";
    const dest = r.route?.destinationCity ?? null;
    const lastGuess = r.guesses[r.guesses.length - 1];
    return {
      index: r.index,
      status: r.session.status as PublicStatus,
      attemptCount: r.session.attemptCount,
      score: r.session.score,
      origin: finished && r.route ? toPublicCity(r.route.originCity) : null,
      destination: finished && dest ? toPublicCity(dest) : null,
      lastDistanceKm:
        finished && lastGuess && dest
          ? Math.round(
              haversineKm(lastGuess.snappedCity.lat, lastGuess.snappedCity.lng, dest.lat, dest.lng),
            )
          : null,
    };
  });

  const totalScore = routeResults
    .filter((r) => r.status !== "PENDING" && r.status !== "ACTIVE")
    .reduce((acc, r) => acc + r.score, 0);
  const last = routeResults[ROUTE_COUNT - 1];
  const matchFinished = !!last && last.status !== "PENDING" && last.status !== "ACTIVE";

  const cur = routes[Math.min(Math.max(currentRouteIndex, 1), ROUTE_COUNT) - 1];
  if (!cur?.route) {
    throw new GameError("Itinéraire courant indisponible", 503);
  }
  const journey = cur.route.journey;
  const session = cur.session ?? { status: "ACTIVE", attemptCount: 0, score: 0 };
  const finished = session.status !== "ACTIVE";
  const dest = cur.route.destinationCity;
  const failed = cur.guesses.filter((g) => !g.correct).length;

  const publicGuesses: PublicGuess[] = cur.guesses.map((g) => ({
    attemptNumber: g.attemptNumber,
    city: toPublicCity(g.snappedCity),
    distanceKm: Math.round(
      haversineKm(g.snappedCity.lat, g.snappedCity.lng, dest.lat, dest.lng),
    ),
    correct: g.correct,
  }));

  return {
    date: dateKey,
    routeIndex: cur.route.routeIndex,
    routeCount: ROUTE_COUNT,
    matchFinished,
    totalScore,
    routeResults,
    origin: toPublicCity(cur.route.originCity),
    totalDurationMin: cur.route.totalDurationMin,
    status: session.status as PublicStatus,
    attemptCount: session.attemptCount,
    score: session.score,
    guesses: publicGuesses,
    hints: unlockedHints(journey, failed),
    destination: finished ? toPublicCity(dest) : null,
    journey: finished
      ? {
          totalDurationMin: journey.totalDurationMin,
          segments: journey.segments.map((s) => ({
            index: s.index,
            kind: s.kind,
            modeDetail: s.modeDetail,
            lineOrCarrier: s.lineOrCarrier,
            durationMin: s.durationMin,
            from: s.from,
            to: s.to,
          })),
        }
      : null,
  };
}

/** Charge les entrées des ROUTE_COUNT manches du match (données serveur). */
async function matchRoutesFor(sessionId: string): Promise<MatchRouteInput[]> {
  const date = challengeDateFromKey(parisDateKey());
  const out: MatchRouteInput[] = [];
  for (let slot = 1; slot <= ROUTE_COUNT; slot++) {
    // Les 3 itinéraires du jour sont calculés à l'initialisation
    // (ensureTodayRoutes) : ils sont toujours présents ici.
    const route = await getRoute(date, slot);
    const rs = await db.routeSession.findUnique({
      where: { sessionId_routeIndex: { sessionId, routeIndex: slot } },
    });
    let guesses: GuessInput[] = [];
    if (rs) {
      const rows = await db.guess.findMany({
        where: { routeSessionId: rs.id },
        orderBy: { attemptNumber: "asc" },
      });
      const cities = await db.city.findMany({
        where: { id: { in: rows.map((r) => r.snappedCityId) } },
      });
      const byId = new Map(cities.map((c) => [c.id, c]));
      guesses = rows.map((r) => ({
        attemptNumber: r.attemptNumber,
        snappedCity: byId.get(r.snappedCityId) as CityCore,
        correct: r.correct,
      }));
    }
    out.push({
      index: slot,
      route: route ? toRouteInput(route) : null,
      session: rs ? { status: rs.status, attemptCount: rs.attemptCount, score: rs.score } : null,
      guesses,
    });
  }
  return out;
}

async function stateFor(guestKey: string): Promise<PublicChallengeState> {
  const session = await getOrCreateSession(guestKey);
  const currentRouteIndex = Math.min(Math.max(session.currentRouteIndex, 1), ROUTE_COUNT);
  const routes = await matchRoutesFor(session.id);
  return buildPublicState(parisDateKey(), routes, currentRouteIndex);
}

/**
 * État public du match du jour pour cet invité : calcule les TROIS itinéraires
 * du jour à l'initialisation s'ils manquent (puis plus rien jusqu'à relancer
 * une partie), puis projette l'état.
 */
export async function getPublicState(guestKey: string): Promise<PublicChallengeState> {
  const routes = await ensureTodayRoutes();
  if (routes.length === 0) throw new GameError("Aucun itinéraire pour aujourd'hui", 404);
  return stateFor(guestKey);
}

/** Limitation de débit sur /api/guess (§7 : ~1 req/s par invité). */
const lastGuessAt = new Map<string, number>();
const GUEST_MIN_INTERVAL_MS = 900;

/**
 * Traite une proposition (§1.2) sur la manche courante : le client n'envoie
 * QUE lat/lng ; le serveur rattache à la ville la plus proche, vérifie, compte
 * l'essai, débloque l'indice et calcule le score. Retourne le nouvel état.
 */
export async function submitGuess(
  guestKey: string,
  clickLat: number,
  clickLng: number,
): Promise<PublicChallengeState> {
  const date = challengeDateFromKey(parisDateKey());

  const session = await getOrCreateSession(guestKey);
  const routeIndex = Math.min(Math.max(session.currentRouteIndex, 1), ROUTE_COUNT);
  const route = await getRoute(date, routeIndex);
  if (!route) throw new GameError("Aucun itinéraire pour aujourd'hui", 404);

  const routeSession = await getOrCreateRouteSession(session.id, routeIndex);
  if (routeSession.status !== "ACTIVE") {
    throw new GameError("Cet itinéraire est déjà terminé — passez au suivant", 409);
  }

  const now = Date.now();
  const last = lastGuessAt.get(guestKey) ?? 0;
  if (now - last < GUEST_MIN_INTERVAL_MS) {
    throw new GameError("Trop de clics à la suite, ralentissez", 429);
  }
  lastGuessAt.set(guestKey, now);

  const snapper = await getSnapper();
  const { city } = snapper(clickLat, clickLng);

  const attemptNumber = routeSession.attemptCount + 1;
  const correct = city.id === route.destCityId;
  await db.guess.create({
    data: {
      routeSessionId: routeSession.id,
      attemptNumber,
      clickLat,
      clickLng,
      snappedCityId: city.id,
      correct,
    },
  });

  let status = routeSession.status;
  let score = routeSession.score;
  let finishedAt: Date | null = routeSession.finishedAt;
  if (correct) {
    status = "WON";
    score = standardScore(attemptNumber);
    finishedAt = new Date();
  } else if (attemptNumber >= MAX_ATTEMPTS) {
    status = "LOST";
    score = proximityScore(
      haversineKm(city.lat, city.lng, route.destinationCity.lat, route.destinationCity.lng),
    );
    finishedAt = new Date();
  }
  await db.routeSession.update({
    where: { id: routeSession.id },
    data: { attemptCount: attemptNumber, status, score, finishedAt },
  });

  // Met à jour le match : totalScore = somme des manches terminées ; le match
  // est DONE quand la dernière manche est terminée.
  if (status !== "ACTIVE") {
    const all = await db.routeSession.findMany({
      where: { sessionId: session.id },
      select: { routeIndex: true, status: true, score: true },
    });
    const totalScore = all
      .filter((r) => r.status !== "ACTIVE")
      .reduce((acc, r) => acc + r.score, 0);
    const matchDone = routeIndex >= ROUTE_COUNT;
    await db.gameSession.update({
      where: { id: session.id },
      data: {
        totalScore,
        status: matchDone ? "DONE" : "ACTIVE",
        finishedAt: matchDone ? finishedAt : session.finishedAt,
      },
    });
  }

  return stateFor(guestKey);
}

/**
 * Passe à l'itinéraire suivant du match (bouton « Itinéraire suivant » de
 * l'écran de résultat d'une manche). La manche courante doit être terminée ;
 * l'itinéraire suivant existe déjà (les 3 ont été calculés à l'initialisation).
 */
export async function nextRoute(guestKey: string): Promise<PublicChallengeState> {
  const date = challengeDateFromKey(parisDateKey());
  const session = await getOrCreateSession(guestKey);
  const routeIndex = Math.min(Math.max(session.currentRouteIndex, 1), ROUTE_COUNT);

  const current = await db.routeSession.findUnique({
    where: { sessionId_routeIndex: { sessionId: session.id, routeIndex } },
  });
  if (!current || current.status === "ACTIVE") {
    throw new GameError("La manche en cours n'est pas terminée", 409);
  }
  if (routeIndex >= ROUTE_COUNT) {
    throw new GameError("Match terminé : les 3 itinéraires sont joués", 409);
  }

  const next = routeIndex + 1;
  // Les 3 itinéraires existent déjà (calculés à l'initialisation).
  const route = await getRoute(date, next);
  if (!route) throw new GameError("Itinéraire suivant indisponible", 503);
  await db.gameSession.update({
    where: { id: session.id },
    data: { currentRouteIndex: next },
  });
  await getOrCreateRouteSession(session.id, next);
  return stateFor(guestKey);
}

/** Nouvelle partie : supprime le match du jour (manches et propositions). */
export async function resetTodaysSession(guestKey: string): Promise<void> {
  const challengeDate = challengeDateFromKey(parisDateKey());
  const session = await db.gameSession.findUnique({
    where: { guestKey_challengeDate: { guestKey, challengeDate } },
  });
  if (!session) return;
  const routeSessions = await db.routeSession.findMany({
    where: { sessionId: session.id },
    select: { id: true },
  });
  if (routeSessions.length > 0) {
    await db.guess.deleteMany({
      where: { routeSessionId: { in: routeSessions.map((r) => r.id) } },
    });
  }
  await db.routeSession.deleteMany({ where: { sessionId: session.id } });
  await db.gameSession.delete({ where: { id: session.id } });
}
