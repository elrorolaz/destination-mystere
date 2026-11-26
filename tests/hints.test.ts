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

  it("cinq indices au total : A, B, C, D, E (pays de la destination)", () => {
    expect(buildHints(journey, "AT").map((h) => h.key)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("indice E : le pays de la destination, en toutes lettres + code ISO", () => {
    const e = buildHints(journey, "AT")[4]!;
    expect(e.key).toBe("E");
    expect(e.title).toBe("Pays de la destination");
    expect(e.body).toBe("La destination se trouve en Autriche (AT)");
    // Sans pays fourni : message neutre (ne fuite rien).
    expect(buildHints(journey)[4]!.body).toBe("Pays de la destination non disponible");
    // Code inconnu : le code est renvoyé tel quel.
    expect(buildHints(journey, "ZZ")[4]!.body).toContain("ZZ");
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

  it("indice A : RER = « Transports urbains » (jamais « Train »), TER = « Train »", () => {
    const mixed: Journey = {
      totalDurationMin: 100,
      segments: [
        { index: 1, kind: "rail", modeDetail: "TER", lineOrCarrier: "TER", durationMin: 40, from: "A", to: "B" },
        { index: 2, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 5, from: "B", to: "B" },
        // RER en kind "rail" (défensif) : doit compter comme transport en commun.
        { index: 3, kind: "rail", modeDetail: "RER", lineOrCarrier: "RER B", durationMin: 30, from: "B", to: "C" },
        { index: 4, kind: "urban", modeDetail: "Métro", lineOrCarrier: "métro 14", durationMin: 10, from: "C", to: "D" },
        { index: 5, kind: "rail", modeDetail: "TGV", lineOrCarrier: "Eurostar", durationMin: 15, from: "D", to: "E" },
      ],
    };
    // TER et TGV (Eurostar) = « Train » ; RER et métro = « Transports urbains ».
    expect(buildHints(mixed, "FR")[0]!.body).toBe(
      "Train  →  Transports urbains  →  Transports urbains  →  Train",
    );
  });

  it("unlockedHints : rien sans échec, A dès le premier échec", () => {
    expect(unlockedHints(journey, 0)).toHaveLength(0);
    const one = unlockedHints(journey, 1);
    expect(one.map((h) => h.key)).toEqual(["A"]);
  });

  it("unlockedHints : E après le 5ᵉ essai manqué — il ne reste alors qu'un seul essai", () => {
    expect(unlockedHints(journey, 3, "AT").map((h) => h.key)).toEqual(["A", "B", "C"]);
    expect(unlockedHints(journey, 4, "AT").map((h) => h.key)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    // 5 échecs → E débloqué (pays) ; le 6e essai est le dernier, seul.
    const five = unlockedHints(journey, 5, "AT");
    expect(five.map((h) => h.key)).toEqual(["A", "B", "C", "D", "E"]);
    expect(five[4]!.body).toContain("Autriche");
    // Plafond à 5 indices : le 6ᵉ essai n'en ajoute pas.
    expect(unlockedHints(journey, 6, "AT").map((h) => h.key)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });
});
