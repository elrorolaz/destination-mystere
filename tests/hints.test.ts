// Projection des indices A → D depuis le journey du fixture (§1.2, §4) — M3.
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

  it("indice D : un POINT DE CORRESPONDANCE (jonction entre deux tronçons de transport)", () => {
    // Jonctions du fixture : Paris-Est, Gare du Nord, Aéroport CDG 2,
    // Vienne-Schwechat (le « to » du dernier tronçon = la destination, exclu).
    // Choix déterministe = le candidat le plus central.
    expect(buildHints(journey)[3]!.title).toBe("Point de correspondance");
    expect(buildHints(journey)[3]!.body).toBe(
      "Le trajet passe par Aéroport CDG 2",
    );
  });

  it("indice D : jamais un arrêt de train, jamais le premier ni le dernier point", () => {
    // Aulnay-sous-Bois et Wien Praterstern sont des arrêts intermédiaires de
    // segments (intermediateStops) : ils ne doivent PAS être proposés.
    const body = buildHints(journey)[3]!.body;
    expect(body).not.toContain("Aulnay-sous-Bois");
    expect(body).not.toContain("Wien Praterstern");
    expect(body).not.toContain("Reims-Centre"); // premier point
    expect(body).not.toContain("Wien Mitte"); // dernier point (destination)

    // Cas minimal A → B → C avec correspondance en B : B est le seul candidat.
    const small: Journey = {
      totalDurationMin: 70,
      segments: [
        { index: 1, kind: "rail", modeDetail: "TER", lineOrCarrier: "TER", durationMin: 30, from: "A", to: "B" },
        { index: 2, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 5, from: "B", to: "B" },
        { index: 3, kind: "rail", modeDetail: "TGV", lineOrCarrier: "TGV", durationMin: 35, from: "B", to: "C" },
      ],
    };
    expect(buildHints(small)[3]!.body).toBe("Le trajet passe par B");
  });

  it("quatre indices au total : A, B, C, D (plus d'ancien indice « compagnies » ni « E »", () => {
    expect(buildHints(journey).map((h) => h.key)).toEqual(["A", "B", "C", "D"]);
  });

  it("indice D dégradé : message neutre sans arrêts intermédiaires", () => {
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
    expect(buildHints(bare)[3]!.body).toBe(
      "Aucun point de correspondance intermédiaire sur ce trajet",
    );
  });

  it("unlockedHints : rien sans échec, A dès le premier échec", () => {
    expect(unlockedHints(journey, 0)).toHaveLength(0);
    const one = unlockedHints(journey, 1);
    expect(one.map((h) => h.key)).toEqual(["A"]);
  });

  it("unlockedHints : plafonne à D — les essais 5 et 6 ne débloquent rien de plus", () => {
    expect(unlockedHints(journey, 3).map((h) => h.key)).toEqual(["A", "B", "C"]);
    expect(unlockedHints(journey, 4).map((h) => h.key)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(unlockedHints(journey, 5).map((h) => h.key)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(unlockedHints(journey, 6).map((h) => h.key)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});
