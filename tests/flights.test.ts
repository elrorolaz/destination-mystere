// Estimation des vols sans API (spécification §5.2) — M2.

import { describe, expect, it } from "vitest";
import {
  airlineForCountry,
  airportFor,
  estimateFlight,
  estimateFlightDurationMin,
  internationalAirportFor,
  CRUISE_SPEED_KMH,
  FLIGHT_OVERHEAD_MIN,
  type AirportPick,
} from "../src/server/routing/flights.ts";

const airports: AirportPick[] = [
  { iata: "CDG", name: "Paris Charles de Gaulle", city: "Paris", lat: 49.0097, lng: 2.5479, type: "large_airport", hubPopulation: 2_100_000, hubCity: "Paris" },
  { iata: "ORY", name: "Paris Orly", city: "Paris", lat: 48.7233, lng: 2.3794, type: "large_airport", hubPopulation: 2_100_000, hubCity: "Paris" },
  { iata: "VIE", name: "Vienne-Schwechat", city: "Vienne", lat: 48.1103, lng: 16.5697, type: "large_airport", hubPopulation: 1_900_000, hubCity: "Vienne" },
  { iata: "IST", name: "Istanbul Airport", city: "Istanbul", lat: 41.2619, lng: 28.7419, type: "large_airport", hubPopulation: 15_000_000, hubCity: "Istanbul" },
];

describe("airportFor", () => {
  it("prend l'aéroport le plus proche à ≤ maxKm", () => {
    expect(airportFor({ lat: 48.8566, lng: 2.3522 }, airports)?.iata).toBe("ORY");
    expect(airportFor({ lat: 48.2082, lng: 16.3738 }, airports)?.iata).toBe("VIE");
  });

  it("null au-delà de la portée", () => {
    expect(airportFor({ lat: 43.3188, lng: 11.3305 }, airports, 45)).toBeNull(); // Sienne
  });
});

describe("estimation de durée de vol (§5.2 : distance / 800 km/h + 35 min)", () => {
  it("formule exacte", () => {
    expect(CRUISE_SPEED_KMH).toBe(800);
    expect(FLIGHT_OVERHEAD_MIN).toBe(35);
    expect(estimateFlightDurationMin(800)).toBe(95); // 60 + 35
    expect(estimateFlightDurationMin(0)).toBe(35);
  });
});

describe("estimateFlight (aéroport le plus proche de chaque extrémité)", () => {
  it("relie Paris (ORY) à Vienne (VIE) avec la bonne durée", () => {
    const f = estimateFlight(
      { name: "Paris", lat: 48.8566, lng: 2.3522 },
      { name: "Vienne", lat: 48.2082, lng: 16.3738 },
      airports,
    );
    expect(f).not.toBeNull();
    expect(f!.from).toBe("Paris (ORY)");
    expect(f!.to).toBe("Vienne (VIE)");
    // Paris → Vienne ≈ 1 035 km → 1035/800*60 + 35 ≈ 113 min
    expect(f!.distanceKm).toBeGreaterThan(1000);
    expect(f!.durationMin).toBe(estimateFlightDurationMin(f!.distanceKm));
    expect(f!.fromCoord).toEqual([48.7233, 2.3794]);
    expect(f!.toCoord).toEqual([48.1103, 16.5697]);
  });

  it("null si la destination n'a pas d'aéroport à 45 km", () => {
    const f = estimateFlight(
      { name: "Paris", lat: 48.8566, lng: 2.3522 },
      { name: "Sienne", lat: 43.3188, lng: 11.3305 },
      airports,
    );
    expect(f).toBeNull();
  });

  it("null si les deux aéroports sont identiques", () => {
    const f = estimateFlight(
      { name: "Paris", lat: 48.8566, lng: 2.3522 },
      { name: "Paris 15e", lat: 48.84, lng: 2.3 },
      airports,
    );
    expect(f).toBeNull();
  });
});

describe("compagnie selon le pays (airlineForCountry)", () => {
  it("pavillon national du pays de destination", () => {
    expect(airlineForCountry("TR")).toBe("Turkish Airlines");
    expect(airlineForCountry("DE")).toBe("Lufthansa");
    expect(airlineForCountry("AT")).toBe("Austrian Airlines");
    expect(airlineForCountry("XX")).toBe("Air France");
    expect(airlineForCountry(undefined)).toBe("Avion");
  });
});

describe("aéroport international le plus proche (dataset filtré large_airport)", () => {
  it("internationalAirportFor = le plus proche du dataset (déjà internationaux uniquement)", () => {
    expect(internationalAirportFor({ lat: 48.8566, lng: 2.3522 }, airports)?.iata).toBe("ORY");
    expect(internationalAirportFor({ lat: 48.2082, lng: 16.3738 }, airports)?.iata).toBe("VIE");
    // Barcelone : aucun aéroport du jeu à ≤ 300 km dans ce dataset réduit → null
    expect(internationalAirportFor({ lat: 41.2973, lng: 2.0785 }, airports, 300)).toBeNull();
  });

  it("estimateFlight nomme le vol d'après la ville de l'aéroport, pas la ville de départ", () => {
    const f = estimateFlight(
      { name: "Villeurbanne", lat: 45.762, lng: 4.83 },
      { name: "Vienne", lat: 48.2082, lng: 16.3738 },
      [
        { iata: "LYS", name: "Lyon Saint-Exupéry", city: "Lyon", lat: 45.7256, lng: 4.9468, type: "large_airport", hubPopulation: 1_700_000, hubCity: "Lyon" },
        { iata: "VIE", name: "Vienne-Schwechat", city: "Vienne", lat: 48.1103, lng: 16.5697, type: "large_airport", hubPopulation: 1_900_000, hubCity: "Vienne" },
      ],
      150,
      45,
    );
    expect(f).not.toBeNull();
    expect(f!.from).toBe("Lyon (LYS)"); // pas « Villeurbanne (LYS) »
    expect(f!.to).toBe("Vienne (VIE)");
  });
});

describe("aéroports MAJEURS uniquement (anti « aéroport minuscule »)", () => {
  const mixed: AirportPick[] = [
    // petit aérodrome régional proche de Paris (medium, hub < 150 k)
    { iata: "BVA", name: "Beauvais-Tillé", city: "Beauvais", lat: 49.4544, lng: 2.1128, type: "medium_airport", hubPopulation: 40_000, hubCity: "Beauvais" },
    // vrais majeurs
    { iata: "CDG", name: "Paris Charles de Gaulle", city: "Paris", lat: 49.0097, lng: 2.5479, type: "large_airport", hubPopulation: 2_100_000, hubCity: "Paris" },
    { iata: "ORY", name: "Paris Orly", city: "Paris", lat: 48.7233, lng: 2.3794, type: "large_airport", hubPopulation: 2_100_000, hubCity: "Paris" },
    { iata: "VIE", name: "Vienne-Schwechat", city: "Vienne", lat: 48.1103, lng: 16.5697, type: "large_airport", hubPopulation: 1_900_000, hubCity: "Vienne" },
  ];

  it("isMajorAirport : large_airport oui, medium à gros hub oui, petit medium non", async () => {
    const { isMajorAirport } = await import("../src/server/routing/flights.ts");
    expect(isMajorAirport(mixed[0]!)).toBe(false); // BVA, hub 40 k
    expect(isMajorAirport(mixed[1]!)).toBe(true); // CDG large
    expect(isMajorAirport({ iata: "X", name: "", city: "", lat: 0, lng: 0, type: "medium_airport", hubPopulation: 300_000 })).toBe(true);
    expect(isMajorAirport({ iata: "Y", name: "", city: "", lat: 0, lng: 0, type: "medium_airport" })).toBe(false);
  });

  it("majorAirportFor ignore le petit aéroport proche quand un majeur existe", async () => {
    const { majorAirportFor } = await import("../src/server/routing/flights.ts");
    // Depuis le centre de Paris : BVA est à ~75 km, CDG à ~23 km — CDG gagne de toute façon,
    // mais depuis Beauvais (2 km de BVA), majorAirportFor ne doit PAS choisir BVA.
    const fromBeauvais = majorAirportFor({ lat: 49.4544, lng: 2.1128 }, mixed, 150);
    expect(fromBeauvais?.iata).not.toBe("BVA");
    expect(["CDG", "ORY"]).toContain(fromBeauvais?.iata);
  });

  it("majorAirportFor renvoie null si aucun majeur à portée", async () => {
    const { majorAirportFor } = await import("../src/server/routing/flights.ts");
    expect(majorAirportFor({ lat: 43.3188, lng: 11.3305 }, [mixed[0]!], 45)).toBeNull(); // Sienne, seul BVA dispo
    expect(majorAirportFor({ lat: 48.8566, lng: 2.3522 }, mixed, 10)).toBeNull(); // aucun à ≤ 10 km du centre
  });
});
