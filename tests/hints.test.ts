// Projection des indices A → E depuis le journey du fixture (§1.2, §4) — M3.
// « Ne pas générer les indices à la main » : tout est déduit de la structure.

import { describe, expect, it } from "vitest";
import type { Journey } from "../src/server/routing/types.ts";
import { buildHints, unlockedHints } from "../src/server/hints.ts";

/** Copie inline du fixture data/fixtures/demo-journey.json (Reims → Vienne). */
const journey: Journey = {
  totalDurationMin: 325,
  segments: [
    {
      index: 1,
      kind: "rail",
      modeDetail: "TGV",
      lineOrCarrier: "TGV inOui",
      durationMin: 46,
      from: "Reims-Centre",
      to: "Paris-Est",
    },
    {
      index: 2,
      kind: "connection",
      modeDetail: "Correspondance",
      lineOrCarrier: "",
      durationMin: 12,
      from: "Paris-Est",
      to: "Gare de l'Est",
    },
    {
      index: 3,
      kind: "urban",
      modeDetail: "Métro",
      lineOrCarrier: "Métro ligne 5",
      durationMin: 4,
      from: "Gare de l'Est",
      to: "Gare du Nord",
    },
    {
      index: 4,
      kind: "connection",
      modeDetail: "Correspondance",
      lineOrCarrier: "",
      durationMin: 5,
      from: "Gare du Nord",
      to: "Gare du Nord (RER)",
    },
    {
      index: 5,
      kind: "urban",
      modeDetail: "RER",
      lineOrCarrier: "RER B",
      durationMin: 34,
      from: "Gare du Nord (RER)",
      to: "Aéroport CDG 2",
      intermediateStops: ["Aulnay-sous-Bois"],
    },
    {
      index: 6,
      kind: "connection",
      modeDetail: "Enregistrement et embarquement",
      lineOrCarrier: "",
      durationMin: 75,
      from: "Aéroport CDG 2",
      to: "Paris-CDG",
    },
    {
      index: 7,
      kind: "air",
      modeDetail: "Avion",
      lineOrCarrier: "Air France",
      durationMin: 110,
      from: "Paris-CDG",
      to: "Vienne-Schwechat",
    },
    {
      index: 8,
      kind: "connection",
      modeDetail: "Correspondance",
      lineOrCarrier: "",
      durationMin: 12,
      from: "Vienne-Schwechat",
      to: "Flughafen Wien",
    },
    {
      index: 9,
      kind: "rail",
      modeDetail: "S-Bahn",
      lineOrCarrier: "S-Bahn S7 (ÖBB)",
      durationMin: 27,
      from: "Flughafen Wien",
      to: "Wien Mitte",
      intermediateStops: ["Wien Praterstern"],
    },
  ],
};

describe("buildHints (fixture Reims → Vienne)", () => {
  it("indice A : catégories des segments de transport, sans les correspondances", () => {
    expect(buildHints(journey)[0]!.body).toBe(
      "Train  →  Transports urbains  →  Transports urbains  →  Avion  →  Train",
    );
  });

  it("indice B : catégories et durées des segments", () => {
    expect(buildHints(journey)[1]!.body).toBe(
      "Train · 46 min  →  Transports urbains · 4 min  →  Transports urbains · 34 min  →  Avion · 110 min  →  Train · 27 min",
    );
  });

  it("indice C : lignes et compagnies brutes", () => {
    expect(buildHints(journey)[2]!.body).toBe(
      "TGV inOui  ·  Métro ligne 5  ·  RER B  ·  Air France  ·  S-Bahn S7 (ÖBB)",
    );
  });

  it("indice D : compagnies dédoublonnées", () => {
    expect(buildHints(journey)[3]!.body).toBe(
      "inOui (SNCF)  ·  RATP  ·  Air France  ·  ÖBB",
    );
  });

  it("indice E : une étape desservie, jamais dans le dernier segment", () => {
    // Wien Praterstern appartient au segment 9 (dernier) : exclu.
    expect(buildHints(journey)[4]!.body).toBe(
      "Le trajet s'arrête à Aulnay-sous-Bois",
    );
  });

  it("indice E dégradé : message neutre sans arrêts intermédiaires", () => {
    const bare: Journey = {
      totalDurationMin: 30,
      segments: [
        {
          index: 1,
          kind: "rail",
          modeDetail: "TER",
          lineOrCarrier: "TER",
          durationMin: 30,
          from: "A",
          to: "B",
        },
      ],
    };
    expect(buildHints(bare)[4]!.body).toBe(
      "Tous les arrêts intermédiaires révéleraient la destination",
    );
  });

  it("unlockedHints : rien sans échec, A dès le premier échec", () => {
    expect(unlockedHints(journey, 0)).toHaveLength(0);
    const one = unlockedHints(journey, 1);
    expect(one.map((h) => h.key)).toEqual(["A"]);
  });

  it("unlockedHints : plafonne à E même au-delà de cinq échecs", () => {
    expect(unlockedHints(journey, 3).map((h) => h.key)).toEqual(["A", "B", "C"]);
    expect(unlockedHints(journey, 6).map((h) => h.key)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });
});
