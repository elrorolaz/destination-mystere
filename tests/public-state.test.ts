// État public du jeu (§7 anti-triche) — M3.
// La fonction buildPublicState est pure : c'est LE garde-fou qui empêche la
// destination et le journey de fuiter vers le client pendant la partie.

import { describe, expect, it } from "vitest";
import type { Journey } from "../src/server/routing/types.ts";
import {
  buildPublicState,
  type ChallengeInput,
  type GuessInput,
  type SessionInput,
} from "../src/server/game-service.ts";

const origin = { id: "2984114", name: "Reims", country: "FR", lat: 49.2583, lng: 4.0317 };
const vienna = { id: "2761369", name: "Vienne", country: "AT", lat: 48.2082, lng: 16.3738 };
const bethune = { id: "580032", name: "Béthune", country: "FR", lat: 50.5302, lng: 2.6452 };

const journey: Journey = {
  totalDurationMin: 325,
  segments: [
    { index: 1, kind: "rail", modeDetail: "TGV", lineOrCarrier: "TGV inOui", durationMin: 46, from: "Reims-Centre", to: "Paris-Est" },
    { index: 2, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 12, from: "Paris-Est", to: "Gare de l'Est" },
    { index: 3, kind: "urban", modeDetail: "Métro", lineOrCarrier: "Métro ligne 5", durationMin: 4, from: "Gare de l'Est", to: "Gare du Nord" },
    { index: 4, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 5, from: "Gare du Nord", to: "Gare du Nord (RER)" },
    { index: 5, kind: "urban", modeDetail: "RER", lineOrCarrier: "RER B", durationMin: 34, from: "Gare du Nord (RER)", to: "Aéroport CDG 2", intermediateStops: ["Aulnay-sous-Bois"] },
    { index: 6, kind: "connection", modeDetail: "Enregistrement et embarquement", lineOrCarrier: "", durationMin: 75, from: "Aéroport CDG 2", to: "Paris-CDG" },
    { index: 7, kind: "air", modeDetail: "Avion", lineOrCarrier: "Air France", durationMin: 110, from: "Paris-CDG", to: "Vienne-Schwechat" },
    { index: 8, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 12, from: "Vienne-Schwechat", to: "Flughafen Wien" },
    { index: 9, kind: "rail", modeDetail: "S-Bahn", lineOrCarrier: "S-Bahn S7 (ÖBB)", durationMin: 27, from: "Flughafen Wien", to: "Wien Mitte", intermediateStops: ["Wien Praterstern"] },
  ],
};

const challenge: ChallengeInput = {
  journey,
  totalDurationMin: 325,
  originCity: origin,
  destinationCity: vienna,
  originCityId: origin.id,
  destCityId: vienna.id,
};

const wrongGuess = (n: number): GuessInput => ({
  attemptNumber: n,
  snappedCity: bethune,
  correct: false,
});

function build(session: SessionInput, guesses: GuessInput[]) {
  return buildPublicState("2026-11-16", challenge, session, guesses);
}

describe("buildPublicState — anti-triche", () => {
  it("masque destination et journey tant que la partie est ACTIVE", () => {
    const state = build(
      { status: "ACTIVE", attemptCount: 2, score: 0 },
      [wrongGuess(1), wrongGuess(2)],
    );
    expect(state.status).toBe("ACTIVE");
    expect(state.destination).toBeNull();
    expect(state.journey).toBeNull();
    const json = JSON.stringify(state);
    expect(json).not.toContain("Vienne");
    expect(json).not.toContain("2761369");
    // Le point de départ, lui, est public.
    expect(state.origin.name).toBe("Reims");
  });

  it("sert exactement les indices A et B après deux échecs", () => {
    const state = build(
      { status: "ACTIVE", attemptCount: 2, score: 0 },
      [wrongGuess(1), wrongGuess(2)],
    );
    expect(state.hints.map((h) => h.key)).toEqual(["A", "B"]);
  });

  it("révèle destination et journey sur une partie gagnée", () => {
    const state = build(
      { status: "WON", attemptCount: 3, score: 700 },
      [
        wrongGuess(1),
        wrongGuess(2),
        { attemptNumber: 3, snappedCity: vienna, correct: true },
      ],
    );
    expect(state.destination?.name).toBe("Vienne");
    expect(state.journey?.segments).toHaveLength(9);
    expect(state.score).toBe(700);
  });

  it("affiche la distance au but par proposition et publie le journey après un échec", () => {
    const state = build(
      { status: "LOST", attemptCount: 6, score: 0 },
      [1, 2, 3, 4, 5, 6].map((n) => wrongGuess(n)),
    );
    // Béthune → Vienne : ~1 030 km orthodromiques.
    expect(state.guesses[0]!.distanceKm).toBeGreaterThan(900);
    expect(state.journey).not.toBeNull();
    expect(state.journey?.totalDurationMin).toBe(325);
    // Six échecs → indices A à D uniquement (les essais 5 et 6 n'en ajoutent pas).
    expect(state.hints.map((h) => h.key)).toEqual(["A", "B", "C", "D"]);
  });
});
