// Client API SNCF/Navitia (spécification §5.1) — M2.
// Normalisation d'une réponse Navitia fictive + client avec fetch mocké.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dateKeyToNavitiaDatetime,
  kindFromPhysicalMode,
  navitiaJourneys,
  normalizeNavitiaJourney,
} from "../src/server/routing/sncf.ts";

/* ---------- Fixture : réponse Navitia (Reims → Paris, 46 min de TGV) ---------- */

const navitiaFixture = {
  journeys: [
    {
      duration: 5400, // 90 min — trajet plus lent, ne doit pas être choisi
      sections: [{ type: "public_transport", duration: 5400, from: { name: "Reims" }, to: { name: "Paris-Est" } }],
    },
    {
      duration: 3540, // 59 min au total
      nb_transfers: 1,
      sections: [
        {
          type: "walking",
          duration: 300,
          from: { name: "Reims", stop_point: { coord: { lat: "49.2583", lon: "4.0317" } } },
          to: { name: "Reims-Centre", stop_point: { coord: { lat: "49.2637", lon: "4.0316" } } },
        },
        {
          type: "public_transport",
          physical_mode: { name: "Long distance train" },
          duration: 2760, // 46 min
          from: { name: "Reims-Centre", stop_point: { coord: { lat: "49.2637", lon: "4.0316" } } },
          to: { name: "Paris-Est", stop_point: { coord: { lat: "48.8761", lon: "2.359" } } },
          display_informations: {
            commercial_mode: { name: "TGV inOui" },
            physical_mode: { name: "TGV" },
            network: "SNCF",
          },
          stop_date_times: [
            { stop_point: { name: "Reims-Centre" } },
            { stop_point: { name: "Château-Thierry" } },
            { stop_point: { name: "Paris-Est" } },
          ],
        },
        {
          type: "transfer",
          duration: 600, // 10 min de correspondance
          from: { name: "Paris-Est", stop_point: { coord: { lat: "48.8761", lon: "2.359" } } },
          to: { name: "Gare de l'Est", stop_point: { coord: { lat: "48.8761", lon: "2.359" } } },
        },
        {
          type: "public_transport",
          physical_mode: { name: "Metro" },
          duration: 240, // 4 min
          from: { name: "Gare de l'Est", stop_point: { coord: { lat: "48.8761", lon: "2.359" } } },
          to: { name: "Gare du Nord", stop_point: { coord: { lat: "48.8809", lon: "2.3553" } } },
          display_informations: { commercial_mode: { name: "Métro ligne 5" } },
          stop_date_times: [
            { stop_point: { name: "Gare de l'Est" } },
            { stop_point: { name: "Gare du Nord" } },
          ],
        },
      ],
    },
  ],
};

describe("normalizeNavitiaJourney", () => {
  const segments = normalizeNavitiaJourney(navitiaFixture.journeys[1]!);

  it("4 sections : marche → TGV → correspondance → métro", () => {
    expect(segments.map((s) => s.kind)).toEqual(["connection", "rail", "connection", "urban"]);
    expect(segments.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("durées en minutes, noms de gares, compagnie (indice C)", () => {
    expect(segments[0]!.durationMin).toBe(5);
    expect(segments[1]!.durationMin).toBe(46);
    expect(segments[1]!.lineOrCarrier).toBe("TGV inOui");
    expect(segments[1]!.modeDetail).toBe("TGV");
    expect(segments[1]!.from).toBe("Reims-Centre");
    expect(segments[1]!.to).toBe("Paris-Est");
    expect(segments[3]!.lineOrCarrier).toBe("Métro ligne 5");
  });

  it("arrêts intermédiaires sans les extrémités (indice D) + coordonnées", () => {
    expect(segments[1]!.intermediateStops).toEqual(["Château-Thierry"]);
    expect(segments[1]!.fromCoord).toEqual([49.2637, 4.0316]);
    expect(segments[1]!.toCoord).toEqual([48.8761, 2.359]);
    // Dernier tronçon : stop_date_times contient les 2 extrémités → aucune interne.
    expect(segments[3]!.intermediateStops).toBeUndefined();
  });
});

describe("kindFromPhysicalMode", () => {
  it("train → rail, métro/tram/bus → urban", () => {
    expect(kindFromPhysicalMode("Long distance train", undefined)).toBe("rail");
    expect(kindFromPhysicalMode("LocalTrain", undefined)).toBe("rail");
    expect(kindFromPhysicalMode("Metro", undefined)).toBe("urban");
    expect(kindFromPhysicalMode("Tramway", undefined)).toBe("urban");
    expect(kindFromPhysicalMode("Bus", undefined)).toBe("urban");
    expect(kindFromPhysicalMode(undefined, "physical_mode:RapidTransit")).toBe("urban");
  });
});

describe("dateKeyToNavitiaDatetime", () => {
  it("AAAA-MM-JJ → AAAAMMJJT080000 (08:00, horaire théorique du jour)", () => {
    expect(dateKeyToNavitiaDatetime("2026-11-21")).toBe("20261121T080000");
  });
});

describe("navitiaJourneys (fetch mocké)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SNCF_API_TOKEN;
  });

  it("sans token : null sans appeler le réseau", async () => {
    delete process.env.SNCF_API_TOKEN;
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await navitiaJourneys(
      { name: "Reims", lat: 49.2583, lng: 4.0317 },
      { name: "Vienne", lat: 48.2082, lng: 16.3738 },
      "20261121T080000",
    );
    expect(res).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("avec token : Basic auth (username=token, mdp vide), coords lon;lat, choisit le plus court", async () => {
    process.env.SNCF_API_TOKEN = "tok123";
    const spy = vi.fn(async () => new Response(JSON.stringify(navitiaFixture), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const res = await navitiaJourneys(
      { name: "Reims", lat: 49.2583, lng: 4.0317 },
      { name: "Paris", lat: 48.8566, lng: 2.3522 },
      "20261121T080000",
    );
    expect(res).not.toBeNull();
    expect(res).toHaveLength(4); // trajet de 59 min, pas celui de 90 min
    expect(res![1]!.lineOrCarrier).toBe("TGV inOui");
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("from=4.0317%3B49.2583"); // lon;lat encodé
    expect(url).toContain("data_freshness=theoretical");
    expect(init.headers).toMatchObject({
      Authorization: "Basic " + btoa("tok123:"),
    });
  });

  it("401 / erreur réseau / pas de trajet → null (le planner bascule en repli)", async () => {
    process.env.SNCF_API_TOKEN = "tok123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await navitiaJourneys({ name: "A", lat: 1, lng: 1 }, { name: "B", lat: 2, lng: 2 }, "20261121T080000");
    expect(res).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ journeys: [] }), { status: 200 })));
    const res2 = await navitiaJourneys({ name: "A", lat: 1, lng: 1 }, { name: "B", lat: 2, lng: 2 }, "20261121T080000");
    expect(res2).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau coupé"); }));
    const res3 = await navitiaJourneys({ name: "A", lat: 1, lng: 1 }, { name: "B", lat: 2, lng: 2 }, "20261121T080000");
    expect(res3).toBeNull();
  });
});
