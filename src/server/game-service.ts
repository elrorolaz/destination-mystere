// Service de jeu : toute la vérité reste ici (§2, §7). Le client ne reçoit
// jamais la destination ni le « journey » avant la fin de partie ; les
// indices sont servis selon le nombre d'essais réellement enregistré.

import { db } from "../lib/db.ts";
import { haversineKm } from "../lib/geo/haversine.ts";
import { parisDateKey, challengeDateFromKey } from "../lib/paris-date.ts";
import type {
  PublicChallengeState,
  PublicGuess,
  PublicStatus,
} from "../lib/game-types.ts";
import { getTodayChallenge, type ChallengeWithCities } from "./challenge-store.ts";
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

/** Partie d'invité identifiée par son cookie httpOnly (M3 ; M4 : comptes). */
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

export interface SessionInput {
  status: string;
  attemptCount: number;
  score: number;
}

export interface GuessInput {
  attemptNumber: number;
  snappedCity: CityCore;
  correct: boolean;
}

/** Réduction de ChallengeWithCities (Prisma) vers l'entrée pure du builder. */
export function toChallengeInput(challenge: ChallengeWithCities): ChallengeInput {
  return {
    journey: challenge.journey as Journey,
    totalDurationMin: challenge.totalDurationMin,
    originCity: challenge.originCity,
    destinationCity: challenge.destinationCity,
    originCityId: challenge.originCityId,
    destCityId: challenge.destCityId,
  };
}

/**
 * État public d'une partie — fonction PURE, testée (§7) : la destination et
 * le journey ne sont projetés qu'en fin de partie ; la distance au but
 * accompagne chaque proposition (§1.2).
 */
export function buildPublicState(
  dateKey: string,
  challenge: ChallengeInput,
  session: SessionInput,
  guesses: GuessInput[],
): PublicChallengeState {
  const journey = challenge.journey;
  const finished = session.status !== "ACTIVE";
  const dest = challenge.destinationCity;
  const failed = guesses.filter((g) => !g.correct).length;

  const publicGuesses: PublicGuess[] = guesses.map((g) => ({
    attemptNumber: g.attemptNumber,
    city: {
      name: g.snappedCity.name,
      country: g.snappedCity.country,
      lat: g.snappedCity.lat,
      lng: g.snappedCity.lng,
    },
    distanceKm: Math.round(
      haversineKm(g.snappedCity.lat, g.snappedCity.lng, dest.lat, dest.lng),
    ),
    correct: g.correct,
  }));

  return {
    date: dateKey,
    origin: {
      name: challenge.originCity.name,
      country: challenge.originCity.country,
      lat: challenge.originCity.lat,
      lng: challenge.originCity.lng,
    },
    totalDurationMin: challenge.totalDurationMin,
    status: session.status as PublicStatus,
    attemptCount: session.attemptCount,
    score: session.score,
    guesses: publicGuesses,
    hints: unlockedHints(journey, failed),
    destination: finished
      ? { name: dest.name, country: dest.country, lat: dest.lat, lng: dest.lng }
      : null,
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

async function stateFor(
  guestKey: string,
  challenge: ChallengeWithCities,
): Promise<PublicChallengeState> {
  const session = await getOrCreateSession(guestKey);
  const rows = await db.guess.findMany({
    where: { sessionId: session.id },
    orderBy: { attemptNumber: "asc" },
  });
  const cities = await db.city.findMany({
    where: { id: { in: rows.map((r) => r.snappedCityId) } },
  });
  const byId = new Map(cities.map((c) => [c.id, c]));
  const guesses: GuessInput[] = rows.map((r) => ({
    attemptNumber: r.attemptNumber,
    snappedCity: byId.get(r.snappedCityId) as CityCore,
    correct: r.correct,
  }));
  return buildPublicState(
    parisDateKey(),
    toChallengeInput(challenge),
    session,
    guesses,
  );
}

/** État public de la partie du jour pour cet invité. */
export async function getPublicState(guestKey: string): Promise<PublicChallengeState> {
  const challenge = await getTodayChallenge();
  if (!challenge) throw new GameError("Aucun défi pour aujourd'hui", 404);
  return stateFor(guestKey, challenge);
}

/** Limitation de débit sur /api/guess (§7 : ~1 req/s par invité). */
const lastGuessAt = new Map<string, number>();
const GUEST_MIN_INTERVAL_MS = 900;

/**
 * Traite une proposition (§1.2) : le client n'envoie QUE lat/lng ; le serveur
 * rattache à la ville la plus proche, vérifie, compte l'essai, débloque
 * l'indice et calcule le score. Retourne le nouvel état public.
 */
export async function submitGuess(
  guestKey: string,
  clickLat: number,
  clickLng: number,
): Promise<PublicChallengeState> {
  const challenge = await getTodayChallenge();
  if (!challenge) throw new GameError("Aucun défi pour aujourd'hui", 404);

  const session = await getOrCreateSession(guestKey);
  if (session.status !== "ACTIVE") {
    throw new GameError("Partie déjà terminée pour aujourd'hui", 409);
  }

  const now = Date.now();
  const last = lastGuessAt.get(guestKey) ?? 0;
  if (now - last < GUEST_MIN_INTERVAL_MS) {
    throw new GameError("Trop de clics à la suite, ralentissez", 429);
  }
  lastGuessAt.set(guestKey, now);

  const snapper = await getSnapper();
  const { city } = snapper(clickLat, clickLng);

  const attemptNumber = session.attemptCount + 1;
  const correct = city.id === challenge.destCityId;
  await db.guess.create({
    data: {
      sessionId: session.id,
      attemptNumber,
      clickLat,
      clickLng,
      snappedCityId: city.id,
      correct,
    },
  });

  let status = session.status;
  let score = session.score;
  let finishedAt: Date | null = session.finishedAt;
  if (correct) {
    status = "WON";
    score = standardScore(attemptNumber);
    finishedAt = new Date();
  } else if (attemptNumber >= MAX_ATTEMPTS) {
    status = "LOST";
    score = proximityScore(
      haversineKm(
        city.lat,
        city.lng,
        challenge.destinationCity.lat,
        challenge.destinationCity.lng,
      ),
    );
    finishedAt = new Date();
  }
  await db.gameSession.update({
    where: { id: session.id },
    data: { attemptCount: attemptNumber, status, score, finishedAt },
  });

  return stateFor(guestKey, challenge);
}

/** Rejoue la journée (développement, fixture uniquement). */
export async function resetTodaysSession(guestKey: string): Promise<void> {
  const challengeDate = challengeDateFromKey(parisDateKey());
  const session = await db.gameSession.findUnique({
    where: { guestKey_challengeDate: { guestKey, challengeDate } },
  });
  if (!session) return;
  await db.guess.deleteMany({ where: { sessionId: session.id } });
  await db.gameSession.delete({ where: { id: session.id } });
}
