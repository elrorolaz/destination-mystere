// Client Transitous/MOTIS : normalisation, sélection « optimal », horodatage Paris — M2.
// Le fixture ci-dessous est un extrait RÉEL de la réponse api.transitous.org
// pour Rennes → Mantes-la-Jolie (TGV INOUI 8604 + Transilien N).

import { describe, expect, it } from "vitest";
import { normalizeLineLabel } from "../src/server/routing/line-names.ts";
import {
  itineraryScore,
  itineraryToSegments,
  kindOfMotisLeg,
  kindOfMotisMode,
  lineOf,
  modeDetailOf,
  normalizeItinerary,
  parisTimeIso,
  selectItinerary,
  TRANSFER_PENALTY_MIN,
  type RouterItinerary,
} from "../src/server/routing/transitous.ts";

/* --- extrait réel (tronqué) de /api/v1/plan Rennes → Mantes-la-Jolie --- */
const realItinerary = {
  duration: 228 * 60,
  transfers: 1,
  startTime: "2026-11-23T07:34:00Z",
  endTime: "2026-11-23T11:22:00Z",
  legs: [
    { mode: "WALK", duration: 60, from: { name: "START", lat: 48.1035, lon: -1.6727 }, to: { name: "Rennes", lat: 48.1035, lon: -1.6727 }, startTime: "2026-11-23T07:34:00Z", endTime: "2026-11-23T07:35:00Z" },
    {
      mode: "HIGHSPEED_RAIL",
      duration: 5700,
      startTime: "2026-11-23T07:35:00Z",
      endTime: "2026-11-23T09:10:00Z",
      from: { name: "Rennes", lat: 48.1035, lon: -1.6727, departure: "2026-11-23T07:35:00Z" },
      to: { name: "Paris Montparnasse Hall 1 - 2", lat: 48.8412, lon: 2.3205, arrival: "2026-11-23T09:10:00Z" },
      routeShortName: "TGV INOUI 8604",
      agencyName: "SNCF VOYAGEURS",
      intermediateStops: [],
    },
    { mode: "WALK", duration: 480, from: { name: "Paris Montparnasse Hall 1 - 2", lat: 48.8412, lon: 2.3205 }, to: { name: "Gare Montparnasse", lat: 48.8412, lon: 2.3205 } },
    {
      mode: "REGIONAL_RAIL",
      duration: 4680,
      startTime: "2026-11-23T09:50:00Z",
      endTime: "2026-11-23T11:08:00Z",
      from: { name: "Gare Montparnasse", lat: 48.8406, lon: 2.3195 },
      to: { name: "Mantes-la-Jolie", lat: 48.9892, lon: 1.7141 },
      routeShortName: "N",
      agencyName: "Transilien",
      intermediateStops: [
        { name: "Vanves - Malakoff", lat: 48.8183, lon: 2.292 },
        { name: "Clamart", lat: 48.8009, lon: 2.2342 },
      ],
    },
  ],
};

describe("normalisation d'un itinéraire MOTIS réel (Rennes → Mantes)", () => {
  const itin = normalizeItinerary(realItinerary as never);

  it("4 legs : marche → TGV → marche → Transilien N", () => {
    expect(itin.legs.map((l) => l.kind)).toEqual(["connection", "rail", "connection", "rail"]);
    expect(itin.durationMin).toBe(228);
    expect(itin.transfers).toBe(1);
  });

  it("ligne nettoyée et compagnie : « TGV INOUI » (pas le n° de train), « Transilien N »", () => {
    expect(itin.legs[1]!.lineOrCarrier).toBe("TGV INOUI");
    expect(itin.legs[1]!.modeDetail).toBe("TGV");
    expect(itin.legs[3]!.lineOrCarrier).toBe("Transilien N");
    expect(itin.legs[3]!.modeDetail).toBe("Transilien");
  });

  it("coordonnées et arrêts intermédiaires réels (indice D)", () => {
    expect(itin.legs[1]!.fromCoord).toEqual([48.1035, -1.6727]);
    expect(itin.legs[3]!.intermediateStops).toEqual(["Vanves - Malakoff", "Clamart"]);
  });

  it("itineraryToSegments chaîne les segments et ajoute la gare de correspondance comme étape", () => {
    const segs = itineraryToSegments(itin);
    expect(segs.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    // Le TGV se termine à « Paris Montparnasse Hall 1 - 2 » : étape réelle du trajet.
    expect(segs[1]!.intermediateStops).toContain("Paris Montparnasse Hall 1 - 2");
    // Le dernier segment (Transilien N) garde ses vrais arrêts intermédiaires.
    expect(segs[3]!.intermediateStops).toContain("Vanves - Malakoff");
    // Jamais la destination dans les arrêts intermédiaires.
    for (const s of segs.slice(0, -1)) {
      expect(s.intermediateStops ?? []).not.toContain("Mantes-la-Jolie");
    }
  });
});

describe("sélection « optimal » (durée + pénalité de correspondance)", () => {
  const mk = (durationMin: number, transfers: number): RouterItinerary => ({
    durationMin,
    transfers,
    startTime: "2026-11-23T07:34:00Z",
    endTime: "2026-11-23T11:00:00Z",
    legs: [],
  });

  it("Rennes → Mantes : TGV + Transilien N (1 corr., 228 min) bat métro + ligne J (2 corr., 202 min)", () => {
    // Données réelles transitous : N=228min/1, J=202min/2, bus=197min/3.
    const n = mk(228, 1);
    const j = mk(202, 2);
    const bus = mk(197, 3);
    expect(itineraryScore(n)).toBe(258); // score indicatif (durée + 30 min/corr.)
    expect(selectItinerary([n, j, bus])).toBe(n); // moins de correspondances d'abord
  });

  it("garde-fou : si le « moins de correspondances » est > 2× plus lent, le plus rapide gagne", () => {
    const slowDirect = mk(600, 0);
    const fastManyTransfers = mk(250, 3); // 600 > 2 × 250
    expect(selectItinerary([slowDirect, fastManyTransfers])).toBe(fastManyTransfers);
    const nearDirect = mk(300, 0); // 300 ≤ 2 × 250 → le direct (moins de corr.) gagne
    expect(selectItinerary([nearDirect, fastManyTransfers])).toBe(nearDirect);
  });

  it("liste vide → null", () => {
    expect(selectItinerary([])).toBeNull();
  });
});

describe("modes et horodatage Paris", () => {
  it("kindOfMotisMode / modeDetailOf / lineOf", () => {
    expect(kindOfMotisMode("HIGHSPEED_RAIL")).toBe("rail");
    expect(kindOfMotisMode("REGIONAL_RAIL")).toBe("rail");
    expect(kindOfMotisMode("SUBWAY")).toBe("urban");
    expect(kindOfMotisMode("WALK")).toBe("connection");
    expect(modeDetailOf("SUBWAY", "RATP")).toBe("Métro");
    expect(modeDetailOf("REGIONAL_RAIL", "Transilien")).toBe("Transilien");
    expect(modeDetailOf("REGIONAL_RAIL", "SNCF")).toBe("TER");
    expect(lineOf({ routeShortName: "TGV INOUI 8604" } as never)).toBe("TGV INOUI");
    expect(lineOf({ routeShortName: "N", agencyName: "Transilien" } as never)).toBe("Transilien N");
  });

  it("parisTimeIso : 08:00 à Paris = 07:00Z en hiver, 06:00Z en été", () => {
    expect(parisTimeIso("2026-11-23", "08:00")).toBe("2026-11-23T07:00:00Z");
    expect(parisTimeIso("2026-07-01", "08:00")).toBe("2026-07-01T06:00:00Z");
  });
});

describe("labels de lignes réels (correction M2 : plus de « TER B » pour le RER B)", () => {
  it("REGIONAL_RAIL en ligne A–E → RER (ex. ligne B à Paris)", () => {
    expect(modeDetailOf("REGIONAL_RAIL", "SNCF", "B")).toBe("RER");
    expect(lineOf({ mode: "REGIONAL_RAIL", routeShortName: "B", agencyName: "SNCF" }, "rail")).toBe("RER B");
  });

  it("Transilien en ligne N → « Transilien N » (inchangé)", () => {
    expect(modeDetailOf("REGIONAL_RAIL", "Transilien", "N")).toBe("Transilien");
    expect(lineOf({ mode: "REGIONAL_RAIL", routeShortName: "N", agencyName: "Transilien" }, "rail")).toBe("Transilien N");
  });

  it("TER reste TER ; un bus « TER » (substitution) n'est pas étiqueté TER", () => {
    expect(modeDetailOf("REGIONAL_RAIL", "SNCF", "")).toBe("TER");
    expect(lineOf({ mode: "BUS", routeShortName: "TER", routeLongName: "Navette gare", agencyName: "SNCF" }, "urban")).toBe("Navette gare");
  });

  it("kindOfMotisLeg : le RER est un transport en commun (urban), le TER reste un train (rail)", () => {
    // RER (REGIONAL_RAIL en ligne A–E) → urban, PAS rail.
    expect(kindOfMotisLeg("REGIONAL_RAIL", "RER")).toBe("urban");
    // TER / TGV / Intercités → rail (train).
    expect(kindOfMotisLeg("REGIONAL_RAIL", "TER")).toBe("rail");
    expect(kindOfMotisLeg("HIGHSPEED_RAIL", "TGV")).toBe("rail");
    expect(kindOfMotisLeg("SUBWAY", "Métro")).toBe("urban");
    expect(kindOfMotisLeg("WALK", "Correspondance")).toBe("connection");
  });

  it("normalizeItinerary : un leg RER B produit un segment urban « RER B » (pas un train)", () => {
    const itin = normalizeItinerary({
      duration: 34 * 60,
      transfers: 0,
      startTime: "2026-11-23T07:00:00Z",
      endTime: "2026-11-23T07:34:00Z",
      legs: [
        { mode: "REGIONAL_RAIL", duration: 34 * 60, routeShortName: "B", agencyName: "SNCF", from: { name: "Gare du Nord (RER)" }, to: { name: "Aéroport CDG 2" } },
      ],
    } as never);
    const segs = itineraryToSegments(itin);
    expect(segs[0]!.kind).toBe("urban"); // transport en commun, pas « train »
    expect(segs[0]!.modeDetail).toBe("RER");
    expect(segs[0]!.lineOrCarrier).toBe("RER B");
  });

  it("normalizeLineLabel : EST → Eurostar, IC → Intercités, métro « 14 » → « métro 14 »", () => {
    expect(normalizeLineLabel("EST 9050")).toBe("Eurostar");
    expect(normalizeLineLabel("EST")).toBe("Eurostar");
    expect(normalizeLineLabel("IC 1234")).toBe("Intercités");
    expect(normalizeLineLabel("IC")).toBe("Intercités");
    expect(normalizeLineLabel("14", "Métro")).toBe("métro 14");
    expect(normalizeLineLabel("M14", "Métro")).toBe("métro 14");
    // Un numéro de bus n'est PAS préfixé « métro ».
    expect(normalizeLineLabel("91", "Bus")).toBe("91");
    // Les autres lignes sont inchangées.
    expect(normalizeLineLabel("TGV INOUI")).toBe("TGV INOUI");
    expect(normalizeLineLabel("RER B")).toBe("RER B");
  });

  it("lineOf applique la normalisation : EST 9050 → Eurostar, IC 12 → Intercités, métro 14 → métro 14", () => {
    expect(lineOf({ mode: "HIGHSPEED_RAIL", routeShortName: "EST 9050", agencyName: "SNCF" } as never)).toBe("Eurostar");
    expect(lineOf({ mode: "REGIONAL_RAIL", routeShortName: "IC 12", agencyName: "SNCF" } as never)).toBe("Intercités");
    expect(lineOf({ mode: "SUBWAY", routeShortName: "14", agencyName: "RATP" } as never)).toBe("métro 14");
    expect(lineOf({ mode: "SUBWAY", routeShortName: "M4", agencyName: "MVG" } as never)).toBe("métro 4");
  });

  it("itineraryToSegments conserve les horaires réels de chaque leg (vérification par leg)", () => {
    const itin = normalizeItinerary(realItinerary as never);
    const segs = itineraryToSegments(itin);
    expect(segs[1]!.startTime).toBe("2026-11-23T07:35:00Z");
    expect(segs[1]!.endTime).toBe("2026-11-23T09:10:00Z");
    expect(segs[3]!.startTime).toBe("2026-11-23T09:50:00Z");
  });

  it("chaque leg = un segment : une correspondance TER + TGV reste DEUX segments (jamais aplati en « TGV »)", () => {
    const itin = normalizeItinerary({
      duration: 200 * 60,
      transfers: 1,
      startTime: "2026-11-23T07:00:00Z",
      endTime: "2026-11-23T10:20:00Z",
      legs: [
        { mode: "REGIONAL_RAIL", duration: 90 * 60, routeShortName: "TER", agencyName: "SNCF", from: { name: "Lannion" }, to: { name: "Rennes" }, intermediateStops: [{ name: "Guingamp" }] },
        { mode: "WALK", duration: 120, from: { name: "Rennes" }, to: { name: "Rennes" } },
        { mode: "HIGHSPEED_RAIL", duration: 90 * 60, routeShortName: "TGV INOUI 8604", agencyName: "SNCF", from: { name: "Rennes" }, to: { name: "Paris Montparnasse" } },
      ],
    } as never);
    const segs = itineraryToSegments(itin);
    const kinds = segs.map((s) => s.kind);
    const modes = segs.map((s) => s.modeDetail);
    expect(kinds).toEqual(["rail", "connection", "rail"]);
    expect(modes).toEqual(["TER", "Correspondance", "TGV"]);
    expect(segs[0]!.lineOrCarrier).toBe("TER");
    expect(segs[2]!.lineOrCarrier).toBe("TGV INOUI");
    // La gare de correspondance (Rennes) est une étape réelle du 1er segment.
    expect(segs[0]!.intermediateStops).toContain("Rennes");
    expect(segs[0]!.intermediateStops).toContain("Guingamp");
  });
});
