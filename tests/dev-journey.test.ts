// Générateur d'itinéraires aléatoires de test (DEV_FIXTURE=random) — M3.
// buildRandomJourney est pure : on la teste sans base de données.
// Vérifications de réalisme : vrais aéroports IATA pour les vols, compagnie
// selon le pays de destination, lignes urbaines du pays de la destination
// (jamais de « RER C » en Turquie), zone FR 100 % rail.

import { describe, expect, it } from "vitest";
import {
  airportFor,
  buildRandomJourney,
  nearestStationCity,
  type AirportPick,
  type DevCityPick,
  type Hub,
} from "../src/server/dev-journey-pure.ts";
import { unlockedHints } from "../src/server/hints.ts";

const origin: DevCityPick = {
  id: "o1",
  name: "Reims",
  country: "FR",
  lat: 49.2583,
  lng: 4.0317,
  population: 180000,
  hasTrainStation: true,
};
const hub: Hub = { name: "Paris", country: "FR", lat: 48.8566, lng: 2.3522 };

const destFR: DevCityPick = {
  id: "dFR",
  name: "Marseille",
  country: "FR",
  lat: 43.2965,
  lng: 5.3698,
  population: 870000,
  hasTrainStation: true,
};
const destTR: DevCityPick = {
  id: "dTR",
  name: "Istanbul",
  country: "TR",
  lat: 41.0082,
  lng: 28.9784,
  population: 15800000,
};
const destDE: DevCityPick = {
  id: "dDE",
  name: "Munich",
  country: "DE",
  lat: 48.1351,
  lng: 11.582,
  population: 1480000,
  hasTrainStation: true,
};
// Sienne : pas d'aéroport à ≤ 45 km, mais une gare.
const destIT: DevCityPick = {
  id: "dIT",
  name: "Sienne",
  country: "IT",
  lat: 43.3188,
  lng: 11.3305,
  population: 53000,
  hasTrainStation: true,
};

const pool: DevCityPick[] = [
  { id: "p1", name: "Châlons-en-Champagne", country: "FR", lat: 48.9567, lng: 4.3633, population: 45000, hasTrainStation: true },
  { id: "p2", name: "Troyes", country: "FR", lat: 48.2973, lng: 4.0794, population: 61000, hasTrainStation: true },
  { id: "p3", name: "Lyon", country: "FR", lat: 45.764, lng: 4.8357, population: 760000, hasTrainStation: true },
  { id: "p4", name: "Valence", country: "FR", lat: 44.933, lng: 4.892, population: 64000, hasTrainStation: true },
  { id: "p5", name: "Lausanne", country: "CH", lat: 46.5197, lng: 6.6323, population: 140000, hasTrainStation: true },
  { id: "p6", name: "Florence", country: "IT", lat: 43.7696, lng: 11.2558, population: 360000, hasTrainStation: true },
];

const airports: AirportPick[] = [
  { iata: "CDG", name: "Paris Charles de Gaulle", city: "Paris", lat: 49.0097, lng: 2.5479, type: "large_airport", hubPopulation: 2_100_000, hubCity: "Paris" },
  { iata: "IST", name: "Istanbul Airport", city: "Istanbul", lat: 41.2619, lng: 28.7419, type: "large_airport", hubPopulation: 15_000_000, hubCity: "Istanbul" },
  { iata: "MUC", name: "Munich Airport", city: "Munich", lat: 48.3538, lng: 11.786, type: "large_airport", hubPopulation: 2_800_000, hubCity: "Munich" },
];

/** rand déterministe pour des tests reproductibles. */
const fixed = (v: number) => () => v;

describe("airportFor / nearestStationCity", () => {
  it("trouve le vrai aéroport le plus proche à ≤ 45 km", () => {
    expect(airportFor({ lat: 48.8566, lng: 2.3522 }, airports)?.iata).toBe("CDG");
    expect(airportFor({ lat: 41.0082, lng: 28.9784 }, airports)?.iata).toBe("IST");
  });

  it("renvoie null si aucun aéroport à portée (Sienne n'a pas d'IATA proche)", () => {
    expect(airportFor(destIT, airports)).toBeNull();
  });

  it("nearestStationCity renvoie la ville elle-même si elle a une gare", () => {
    expect(nearestStationCity(destIT, pool).id).toBe("dIT");
  });

  it("nearestStationCity replie sur la gare la plus proche sinon", () => {
    const noStation: DevCityPick = { ...destIT, id: "x", hasTrainStation: false };
    expect(nearestStationCity(noStation, pool).hasTrainStation).toBe(true);
  });
});

describe("zone FR : 100 % rail, marques SNCF, découpage du long trajet", () => {
  const pick = buildRandomJourney(origin, destFR, hub, pool, airports, "FR", fixed(0.4));

  it("aucun segment aérien", () => {
    expect(pick.zone).toBe("FR");
    expect(pick.journey.segments.some((s) => s.kind === "air")).toBe(false);
  });

  it("tous les tronçons rail sont des trains SNCF (TER/Intercités/TGV)", () => {
    const rail = pick.journey.segments.filter((s) => s.kind === "rail");
    expect(rail.length).toBeGreaterThanOrEqual(3); // origine→hub + hub→Marseille découpé
    for (const s of rail) {
      expect(s.lineOrCarrier).toContain("SNCF");
    }
  });

  it("arrive à la destination, indices séquentiels, coords partout, durée = somme", () => {
    const segs = pick.journey.segments;
    expect(segs[0]!.from).toBe("Reims");
    expect(segs[segs.length - 1]!.to).toBe("Marseille");
    segs.forEach((s, i) => {
      expect(s.index).toBe(i + 1);
      expect(s.fromCoord).toBeDefined();
      expect(s.toCoord).toBeDefined();
    });
    expect(pick.journey.totalDurationMin).toBe(segs.reduce((a, s) => a + s.durationMin, 0));
  });

  it("nourrit l'indice D (arrêt intermédiaire hors dernier segment, jamais la destination)", () => {
    const hints = unlockedHints(pick.journey, 4);
    expect(hints.map((h) => h.key)).toEqual(["A", "B", "C", "D"]);
    expect(hints[3]!.body).toContain("s'arrête à");
    expect(hints[3]!.body).not.toContain("Marseille");
  });
});

describe("zone EU avec aéroport : vrai vol IATA, compagnie du pays d'arrivée", () => {
  const pick = buildRandomJourney(origin, destTR, hub, pool, airports, "EU", fixed(0.1));

  it("un segment air entre vrais aéroports, compagnie turque vers la Turquie", () => {
    const air = pick.journey.segments.filter((s) => s.kind === "air");
    expect(air).toHaveLength(1);
    expect(air[0]!.lineOrCarrier).toBe("Turkish Airlines");
    expect(air[0]!.from).toBe("Paris (CDG)");
    expect(air[0]!.to).toBe("Istanbul (IST)");
  });

  it("aucune ligne française type RER dans une ville turque", () => {
    for (const s of pick.journey.segments) {
      expect(s.lineOrCarrier).not.toContain("RER");
      expect(s.lineOrCarrier).not.toContain("Métro ligne");
    }
    const urban = pick.journey.segments.filter((s) => s.kind === "urban");
    expect(urban.length).toBeGreaterThan(0);
    expect(["Metro M1", "Tram T1", "Metrobüs", "Bus 34"]).toContain(urban[urban.length - 1]!.lineOrCarrier);
  });

  it("termine à la destination", () => {
    const segs = pick.journey.segments;
    expect(segs[segs.length - 1]!.to).toBe("Istanbul");
  });
});

describe("zone EU, destination avec aéroport allemand", () => {
  it("vole Lufthansa vers Munich (MUC)", () => {
    const pick = buildRandomJourney(origin, destDE, hub, pool, airports, "EU", fixed(0.1));
    const air = pick.journey.segments.find((s) => s.kind === "air");
    expect(air?.lineOrCarrier).toBe("Lufthansa");
    expect(air?.to).toBe("Munich (MUC)");
  });
});

describe("zone EU sans aéroport à la destination : train international + urbain", () => {
  const pick = buildRandomJourney(origin, destIT, hub, pool, airports, "EU", fixed(0.9));

  it("aucun vol, arrivée en train du pays (Italie → Trenitalia) puis urbain", () => {
    expect(pick.journey.segments.some((s) => s.kind === "air")).toBe(false);
    const rail = pick.journey.segments.filter((s) => s.kind === "rail");
    // Le tronçon international Paris → Sienne n'est pas un train SNCF.
    expect(rail.some((s) => s.lineOrCarrier.includes("Trenitalia"))).toBe(true);
    const segs = pick.journey.segments;
    expect(segs[segs.length - 1]!.to).toBe("Sienne");
  });

  it("les segments rail suivent des villes à gare (découpage réaliste)", () => {
    const rail = pick.journey.segments.filter((s) => s.kind === "rail");
    // Paris → Sienne (~735 km) découpé via au moins une ville intermédiaire.
    expect(rail.length).toBeGreaterThanOrEqual(3);
  });
});

describe("marque selon le corridor (pas de marque étrangère en France)", () => {
  const destCH: DevCityPick = {
    id: "dCH",
    name: "Lausanne",
    country: "CH",
    lat: 46.5197,
    lng: 6.6323,
    population: 140000,
    hasTrainStation: true,
  };
  // Lausanne n'a pas d'aéroport dans la liste de test → trajet 100 % rail.
  const pick = buildRandomJourney(origin, destCH, hub, pool, airports, "EU", fixed(0.9));

  it("Reims → Paris reste SNCF ; Paris → Lausanne est un train suisse (Lyria)", () => {
    const rail = pick.journey.segments.filter((s) => s.kind === "rail");
    const reimsParis = rail.find((s) => s.from === "Reims" && s.to === "Paris");
    expect(reimsParis?.lineOrCarrier).toContain("SNCF");
    const parisLausanne = rail.find((s) => s.from === "Paris" && s.to === "Lausanne");
    expect(parisLausanne?.lineOrCarrier).toBe("TGV Lyria");
    // Aucune marque polonaise ou allemande dans ce trajet franco-suisse.
    for (const s of rail) {
      expect(s.lineOrCarrier).not.toContain("PKP");
      expect(s.lineOrCarrier).not.toContain("DB");
    }
  });
});
