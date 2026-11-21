// Vérification d'itinéraire avant publication (M2) — routeur factice.

import { describe, expect, it } from "vitest";
import type { Journey } from "../src/server/routing/types.ts";
import type { AirportPick } from "../src/server/routing/flights.ts";
import { verifyJourney } from "../src/server/routing/verify.ts";
import { estimateFlightDurationMin } from "../src/server/routing/flights.ts";
import { FakeRouter, makeItin, makeLeg } from "./helpers.ts";

const paris = { name: "Paris", lat: 48.8566, lng: 2.3522 };
const reims = { name: "Reims", lat: 49.2583, lng: 4.0317 };
const airports: AirportPick[] = [
  { iata: "CDG", name: "Paris CDG", city: "Paris", lat: 49.0097, lng: 2.5479, hubPopulation: 2200000 },
  { iata: "VIE", name: "Vienne", city: "Vienne", lat: 48.1103, lng: 16.5697, hubPopulation: 1900000 },
];

/** Faux routeur : connaît un TER Paris Gare de l'Est → Reims (60 min). */
const terRouter = new FakeRouter((from, to) => {
  const a = [from.lat, from.lng] as [number, number];
  const b = [to.lat, to.lng] as [number, number];
  return [
    makeItin([
      makeLeg("rail", from.name, to.name, {
        lineOrCarrier: "TER",
        modeDetail: "TER",
        durationMin: 60,
        fromCoord: a,
        toCoord: b,
      }),
    ]),
  ];
});

function journeyParisReims(): Journey {
  return {
    totalDurationMin: 60,
    segments: [
      {
        index: 1,
        kind: "rail",
        modeDetail: "TER",
        lineOrCarrier: "TER",
        durationMin: 60,
        from: "Paris Gare de l'Est",
        to: "Reims",
        fromCoord: [48.8761, 2.359],
        toCoord: [49.2583, 4.0317],
      },
    ],
  };
}

describe("verifyJourney — cas valides", () => {
  it("un itinéraire réel, chaîné et optimal passe", async () => {
    const report = await verifyJourney(journeyParisReims(), { origin: paris, dest: reims }, terRouter, "2026-11-23T07:00:00Z", airports);
    expect(report.reasons).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("verifyJourney — rejets", () => {
  it("chaînage rompu (segment 2 part de Lyon)", async () => {
    const j = journeyParisReims();
    j.segments.push({
      index: 2, kind: "rail", modeDetail: "TER", lineOrCarrier: "TER", durationMin: 30,
      from: "Lyon", to: "Reims", fromCoord: [45.764, 4.8357], toCoord: [49.2583, 4.0317],
    });
    j.totalDurationMin = 90;
    const report = await verifyJourney(j, { origin: paris, dest: reims }, terRouter, "2026-11-23T07:00:00Z", airports);
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("chaînage rompu"))).toBe(true);
  });

  it("ligne inexistante dans les données GTFS réelles", async () => {
    const j = journeyParisReims();
    j.segments[0]!.lineOrCarrier = "TGV INOUI"; // le faux routeur ne connaît que TER
    const report = await verifyJourney(j, { origin: paris, dest: reims }, terRouter, "2026-11-23T07:00:00Z", airports);
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("aucune ligne réelle"))).toBe(true);
  });

  it("sous-optimal : 200 min retenues alors que le routeur propose 60 min", async () => {
    const j = journeyParisReims();
    j.segments[0]!.durationMin = 200;
    j.totalDurationMin = 200;
    const report = await verifyJourney(j, { origin: paris, dest: reims }, terRouter, "2026-11-23T07:00:00Z", airports, { toleranceMin: 5 });
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("sous-optimal"))).toBe(true);
  });

  it("leg aérien avec un IATA inconnu du dataset → rejeté", async () => {
    const j: Journey = {
      totalDurationMin: 200,
      segments: [
        {
          index: 1, kind: "air", modeDetail: "Avion", lineOrCarrier: "Avion", durationMin: 200,
          from: "Paris (XXX)", to: "Vienne (VIE)", fromCoord: [49.0097, 2.5479], toCoord: [48.1103, 16.5697],
        },
      ],
    };
    const report = await verifyJourney(j, { origin: paris, dest: { name: "Vienne", lat: 48.2082, lng: 16.3738 } }, terRouter, "2026-11-23T07:00:00Z", airports);
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("aéroport inconnu"))).toBe(true);
  });

  it("leg aérien valide (vrais IATA, durée cohérente) mais vol non optimal → rejeté", async () => {
    const km = 1035;
    const j: Journey = {
      totalDurationMin: estimateFlightDurationMin(km),
      segments: [
        {
          index: 1, kind: "air", modeDetail: "Avion", lineOrCarrier: "Avion",
          durationMin: estimateFlightDurationMin(km),
          from: "Paris (CDG)", to: "Vienne (VIE)", fromCoord: [49.0097, 2.5479], toCoord: [48.1103, 16.5697],
        },
      ],
    };
    // Le routeur connaît un direct Paris→Vienne de 60 min : le vol n'est pas optimal.
    const report = await verifyJourney(
      j,
      { origin: paris, dest: { name: "Vienne", lat: 48.2082, lng: 16.3738 } },
      terRouter,
      "2026-11-23T07:00:00Z",
      airports,
    );
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("non optimal"))).toBe(true);
  });

  it("totalDurationMin incohérent avec la somme des segments", async () => {
    const j = journeyParisReims();
    j.totalDurationMin = 999;
    const report = await verifyJourney(j, { origin: paris, dest: reims }, terRouter, "2026-11-23T07:00:00Z", airports);
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("totalDurationMin"))).toBe(true);
  });
});

describe("vérification par leg (correction M2 : horaires réels + correspondances)", () => {
  it("chaque leg est rejoué à SON horaire de départ (startTime), pas à 08:00", async () => {
    const seenTimes: (string | undefined)[] = [];
    const timedRouter = new FakeRouter((from, to, timeIso) => {
      seenTimes.push(timeIso);
      const isDirect = from.name === "A" && to.name === "C";
      const line = from.name === "A" && to.name === "B" ? "TER" : "TGV INOUI";
      return [
        makeItin([
          makeLeg("rail", from.name, to.name, {
            lineOrCarrier: line,
            durationMin: isDirect ? 130 : from.name === "B" ? 70 : 60, // le direct existe mais ne bat pas le journey (130 min)
            fromCoord: [from.lat, from.lng],
            toCoord: [to.lat, to.lng],
          }),
        ]),
      ];
    });
    const journey: Journey = {
      totalDurationMin: 130,
      segments: [
        { index: 1, kind: "rail", modeDetail: "TER", lineOrCarrier: "TER", durationMin: 60, from: "A", to: "B", fromCoord: [48.0, 2.0], toCoord: [48.5, 3.0], startTime: "2026-11-23T07:00:00Z", endTime: "2026-11-23T08:00:00Z" },
        { index: 2, kind: "rail", modeDetail: "TGV", lineOrCarrier: "TGV INOUI", durationMin: 70, from: "B", to: "C", fromCoord: [48.5, 3.0], toCoord: [49.0, 4.0], startTime: "2026-11-23T09:30:00Z", endTime: "2026-11-23T10:40:00Z" },
      ],
    };
    const report = await verifyJourney(
      journey,
      { origin: { name: "A", lat: 48.0, lng: 2.0 }, dest: { name: "C", lat: 49.0, lng: 4.0 } },
      timedRouter,
      "2026-11-23T07:00:00Z",
      airports,
    );
    expect(report.ok).toBe(true);
    // Le 2e leg a été rejoué à 09:25 (son horaire 09:30 moins la marge de 5 min),
    // pas à 07:00 (départ du trajet).
    expect(seenTimes).toContain("2026-11-23T09:25:00Z");
    expect(seenTimes).not.toContain("2026-11-23T09:30:00Z");
  });

  it("rejette un leg dont les arrêts intermédiaires annoncés ne sont pas desservis", async () => {
    const router = new FakeRouter((from, to) => [
      makeItin([
        makeLeg("rail", from.name, to.name, {
          lineOrCarrier: "TER",
          durationMin: 60,
          intermediateStops: ["Guingamp"], // ne dessert PAS "Lamballe"
          fromCoord: [from.lat, from.lng],
          toCoord: [to.lat, to.lng],
        }),
      ]),
    ]);
    const journey: Journey = {
      totalDurationMin: 60,
      segments: [
        {
          index: 1,
          kind: "rail",
          modeDetail: "TER",
          lineOrCarrier: "TER",
          durationMin: 60,
          from: "Lannion",
          to: "Rennes",
          fromCoord: [48.7, -3.5],
          toCoord: [48.1, -1.7],
          intermediateStops: ["Lamballe"], // arrêt fantaisiste
        },
      ],
    };
    const report = await verifyJourney(
      journey,
      { origin: { name: "Lannion", lat: 48.7, lng: -3.5 }, dest: { name: "Rennes", lat: 48.1, lng: -1.7 } },
      router,
      "2026-11-23T07:00:00Z",
      airports,
    );
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("arrêts intermédiaires non desservis"))).toBe(true);
  });

  it("accepte quand tous les arrêts intermédiaires sont bien desservis", async () => {
    const router = new FakeRouter((from, to) => [
      makeItin([
        makeLeg("rail", from.name, to.name, {
          lineOrCarrier: "TER",
          durationMin: 60,
          intermediateStops: ["Guingamp", "Lamballe"],
          fromCoord: [from.lat, from.lng],
          toCoord: [to.lat, to.lng],
        }),
      ]),
    ]);
    const journey: Journey = {
      totalDurationMin: 60,
      segments: [
        {
          index: 1,
          kind: "rail",
          modeDetail: "TER",
          lineOrCarrier: "TER",
          durationMin: 60,
          from: "Lannion",
          to: "Rennes",
          fromCoord: [48.7, -3.5],
          toCoord: [48.1, -1.7],
          intermediateStops: ["Guingamp", "Lamballe"],
        },
      ],
    };
    const report = await verifyJourney(
      journey,
      { origin: { name: "Lannion", lat: 48.7, lng: -3.5 }, dest: { name: "Rennes", lat: 48.1, lng: -1.7 } },
      router,
      "2026-11-23T07:00:00Z",
      airports,
    );
    expect(report.ok).toBe(true);
  });

  it("rejette un vol vers un aéroport qui n'est pas dans le dataset international", async () => {
    const journey: Journey = {
      totalDurationMin: 200,
      segments: [
        {
          index: 1,
          kind: "air",
          modeDetail: "Avion",
          lineOrCarrier: "Air France",
          durationMin: 200,
          from: "Paris (CDG)",
          to: "Quelquepart (ZZZ)", // ZZZ n'existe pas
          fromCoord: [49.0097, 2.5479],
          toCoord: [48.2, 16.37],
        },
      ],
    };
    const report = await verifyJourney(
      journey,
      { origin: { name: "Paris", lat: 48.8566, lng: 2.3522 }, dest: { name: "Vienne", lat: 48.2082, lng: 16.3738 } },
      terRouter,
      "2026-11-23T07:00:00Z",
      airports,
    );
    expect(report.ok).toBe(false);
    expect(report.reasons.some((r) => r.includes("aéroport inconnu"))).toBe(true);
  });
});
