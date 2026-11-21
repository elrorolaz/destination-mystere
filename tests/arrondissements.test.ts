// Groupement des arrondissements dans la ville parente (scripts/lib) — M2.
// Un clic dans le 13e de Paris doit s'afficher « Paris », jamais
// « Paris 13e Arrondissement » ; idem Lyon 03 → Lyon, Marseille 08 → Marseille.

import { describe, expect, it } from "vitest";
import {
  groupArrondissements,
  isArrondissementSection,
  type RawCityLike,
} from "../scripts/lib/arrondissements.ts";

const raw: RawCityLike[] = [
  { id: "2988507", name: "Paris", country: "FR", lat: 48.8534, lng: 2.3488, population: 2138551 },
  { id: "x1", name: "Paris 13e Arrondissement", country: "FR", lat: 48.826, lng: 2.36, population: 177833, featureCode: "PPLX" },
  { id: "x2", name: "Paris 15 Vaugirard", country: "FR", lat: 48.841, lng: 2.3, population: 229713, featureCode: "PPL" },
  { id: "x7", name: "Marseille 08", country: "FR", lat: 43.3, lng: 5.4, population: 78837, featureCode: "PPL" },
  { id: "2643743", name: "Lyon", country: "FR", lat: 45.764, lng: 4.8357, population: 520774 },
  { id: "x3", name: "Lyon 03", country: "FR", lat: 45.76, lng: 4.83, population: 102725, featureCode: "PPLX" },
  { id: "2995469", name: "Marseille", country: "FR", lat: 43.2965, lng: 5.3698, population: 870000 },
  { id: "x4", name: "Marseille 13", country: "FR", lat: 43.27, lng: 5.37, population: 89316, featureCode: "PPLX" },
  { id: "x5", name: "Vienna 1.-Innere Stadt", country: "AT", lat: 48.208, lng: 16.37, population: 30000, featureCode: "PPLX" },
  { id: "2867714", name: "Vienna", country: "AT", lat: 48.2082, lng: 16.3738, population: 1900000 },
  { id: "x6", name: "Quartier sans parent connu", country: "FR", lat: 44.0, lng: 0.0, population: 6000, featureCode: "PPLX" },
  { id: "ok1", name: "Rennes", country: "FR", lat: 48.1173, lng: -1.6778, population: 220000 },
];

describe("isArrondissementSection", () => {
  it("détecte PPLX et les noms en « Arrondissement »", () => {
    expect(isArrondissementSection(raw[1]!)).toBe(true);
    expect(isArrondissementSection({ ...raw[0]!, name: "Paris 11e Arrondissement" })).toBe(true);
    expect(isArrondissementSection(raw[0]!)).toBe(false);
  });
});

describe("groupArrondissements", () => {
  const grouped = groupArrondissements(raw);
  const byId = new Map(grouped.map((c) => [c.id, c]));

  it("renomme les arrondissements de Paris/Lyon/Marseille du nom de la ville parente", () => {
    expect(byId.get("x1")!.name).toBe("Paris");
    expect(byId.get("x2")!.name).toBe("Paris"); // quartier PPL « Paris 15 Vaugirard »
    expect(byId.get("x7")!.name).toBe("Marseille"); // « Marseille 08 » (PPL)
    expect(byId.get("x3")!.name).toBe("Lyon");
    expect(byId.get("x4")!.name).toBe("Marseille");
  });

  it("groupe aussi les sections étrangères (Vienna 1. → Vienna)", () => {
    expect(byId.get("x5")!.name).toBe("Vienna");
  });

  it("conserve les coordonnées et l'id (cible de snap fine, nom groupé)", () => {
    expect(byId.get("x1")!.lat).toBe(48.826);
    expect(byId.get("x1")!.id).toBe("x1");
  });

  it("laisse inchangée une section sans parent dans le jeu de données", () => {
    expect(byId.get("x6")!.name).toBe("Quartier sans parent connu");
  });

  it("ne touche pas aux villes normales", () => {
    expect(byId.get("2988507")!.name).toBe("Paris");
    expect(byId.get("ok1")!.name).toBe("Rennes");
  });

  it("ne regroupe pas un nom qui n'est pas un préfixe (ex. « Pariset » ≠ « Paris » ville fictive)", () => {
    const data: RawCityLike[] = [
      { id: "p", name: "Paris", country: "FR", lat: 0, lng: 0, population: 100 },
      { id: "q", name: "Parisot", country: "FR", lat: 1, lng: 1, population: 5000, featureCode: "PPLX" },
    ];
    // « Parisot » ne commence pas par « Paris » + frontière de mot → inchangé
    expect(groupArrondissements(data).find((c) => c.id === "q")!.name).toBe("Parisot");
  });
});
