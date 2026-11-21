// VÉRIFICATION d'un itinéraire avant publication dans le jeu (M2).
//
// Un itinéraire n'est stocké dans DailyChallenge que s'il passe verifyJourney :
//   1. STRUCTURE   — segments chaînés ( chaque « from » = « to » précédent à
//                    ≤ 3 km ou même nom), durées > 0, total cohérent, coords OK ;
//   2. EXISTENCE   — chaque leg de transport est re-joué auprès du routeur
//                    (from → to À L'HEURE RÉELLE DU LEG, startTime) : une ligne
//                    identique doit exister dans les données GTFS réelles et
//                    desservir tous les arrêts intermédiaires annoncés (toutes
//                    les correspondances sont vérifiées). Les legs aériens sont
//                    validés contre le dataset d'aéroports internationaux IATA ;
//   3. OPTIMALITÉ  — le journey retenu n'est pas plus lent que le meilleur
//                    itinéraire réaliste proposé par le routeur (tolérance
//                    configurable), ou que le candidat avion quand il y en a un.
//
// Coût : ~(#legs + 1) appels au routeur, une fois par jour au cron — négligeable.

import { haversineKm } from "../../lib/geo/haversine.ts";
import type { Journey, JourneySegment } from "./types.ts";
import { estimateFlightDurationMin, type AirportPick } from "./flights.ts";
import {
  selectItinerary,
  type Router,
  type TransitEndpoint,
} from "./transitous.ts";

export interface VerificationReport {
  ok: boolean;
  reasons: string[];
}

export interface VerifyOptions {
  /** Marge d'optimalité (min) : le retenu peut dépasser le best de ce délai. */
  toleranceMin?: number;
  /** Seuil de distance minimale d'un aéroport (km). */
  minAirportKm?: number;
}

const CONTINUITY_MAX_KM = 3;
/** Durée totale max d'un défi publiable (au-delà, la paire est réessayée). */
export const MAX_JOURNEY_MIN = 720; // 12 h

/** Normalise un nom de ligne pour comparaison (minuscules, sans chiffres/espaces). */
function normLine(s: string): string {
  return s.toLowerCase().replace(/[^a-zàâäéèêëîïôöùûüç]/g, "");
}

function samePlace(aName: string, aCoord: [number, number] | undefined, bName: string, bCoord: [number, number] | undefined): boolean {
  if (aName && bName && aName === bName) return true;
  if (aCoord && bCoord) {
    return haversineKm(aCoord[0], aCoord[1], bCoord[0], bCoord[1]) <= CONTINUITY_MAX_KM;
  }
  return false;
}

/**
 * Vérifie un journey complet. `timeIso` = instant de départ du trajet
 * (horaire du défi), utilisé pour la vérification d'optimalité.
 */
export async function verifyJourney(
  journey: Journey,
  endpoints: { origin: TransitEndpoint; dest: TransitEndpoint },
  router: Router,
  timeIso: string,
  airports: readonly AirportPick[],
  opts: VerifyOptions = {},
): Promise<VerificationReport> {
  const reasons: string[] = [];
  const toleranceMin = opts.toleranceMin ?? 5;
  const minAirportKm = opts.minAirportKm ?? 400;

  /* ---- 1. Structure ---- */
  const segs = journey.segments;
  if (segs.length === 0) reasons.push("journey vide");
  segs.forEach((s, i) => {
    if (s.index !== i + 1) reasons.push("segment " + i + " : index non séquentiel");
    if (!(s.durationMin > 0)) reasons.push("segment " + s.index + " : durée nulle");
    if (!s.fromCoord || !s.toCoord) reasons.push("segment " + s.index + " : coordonnées manquantes");
  });
  const total = segs.reduce((a, s) => a + s.durationMin, 0);
  if (Math.abs(total - journey.totalDurationMin) > 1) {
    reasons.push("totalDurationMin incohérent (" + journey.totalDurationMin + " vs somme " + total + ")");
  }
  if (journey.totalDurationMin > MAX_JOURNEY_MIN) {
    reasons.push(
      "durée totale invraisemblable pour un défi (" + journey.totalDurationMin + " min > " + MAX_JOURNEY_MIN + " min)",
    );
  }
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1]!;
    const cur = segs[i]!;
    if (!samePlace(prev.to, prev.toCoord, cur.from, cur.fromCoord)) {
      reasons.push(
        "chaînage rompu entre segments " + prev.index + " et " + cur.index +
          " : « " + prev.to + " » → « " + cur.from + " »",
      );
    }
  }
  const first = segs[0];
  const last = segs[segs.length - 1];
  if (first && !samePlace(endpoints.origin.name, [endpoints.origin.lat, endpoints.origin.lng], first.from, first.fromCoord)) {
    reasons.push("le trajet ne part pas de l'origine (" + endpoints.origin.name + ")");
  }
  if (last && !samePlace(endpoints.dest.name, [endpoints.dest.lat, endpoints.dest.lng], last.to, last.toCoord)) {
    reasons.push("le trajet n'arrive pas à la destination (" + endpoints.dest.name + ")");
  }

  /* ---- 2. Existence réelle de chaque leg ---- */
  for (const s of segs) {
    if (s.kind === "connection") continue;
    // Leg estimé (navette aéroport §5.2) : pas de GTFS à rejouer, mais il
    // doit arriver exactement à l'aéroport du vol (contrôlé par le chaînage).
    if (s.estimated) continue;
    if (s.kind === "air") {
      const mFrom = /\(([A-Z]{3})\)\s*$/.exec(s.from);
      const mTo = /\(([A-Z]{3})\)\s*$/.exec(s.to);
      const okFrom = mFrom && airports.some((a) => a.iata === mFrom[1]);
      const okTo = mTo && airports.some((a) => a.iata === mTo[1]);
      if (!okFrom || !okTo) {
        reasons.push("segment " + s.index + " : aéroport inconnu du dataset IATA (" + s.from + " → " + s.to + ")");
        continue;
      }
      if (s.fromCoord && s.toCoord) {
        const km = haversineKm(s.fromCoord[0], s.fromCoord[1], s.toCoord[0], s.toCoord[1]);
        if (km < minAirportKm) reasons.push("segment " + s.index + " : vol trop court (" + Math.round(km) + " km)");
        const expected = estimateFlightDurationMin(km);
        if (Math.abs(s.durationMin - expected) > 30) {
          reasons.push("segment " + s.index + " : durée de vol invraisemblable (" + s.durationMin + " min vs ~" + expected + " min)");
        }
      }
      continue;
    }
    // Leg rail/urban : rejoué auprès du routeur À L'HEURE RÉELLE DU LEG
    // (startTime du segment, moins 5 min de marge car le routeur exclut la
    // circulation qui part exactement à l'instant demandé), pas à l'heure de
    // départ du trajet — c'est ce qui garantit que la bonne circulation
    // (TER, TGV…) existe bien à cet horaire.
    const from = { name: s.from, lat: s.fromCoord?.[0] ?? endpoints.origin.lat, lng: s.fromCoord?.[1] ?? endpoints.origin.lng };
    const to = { name: s.to, lat: s.toCoord?.[0] ?? endpoints.dest.lat, lng: s.toCoord?.[1] ?? endpoints.dest.lng };
    const legTime = s.startTime
      ? new Date(Date.parse(s.startTime) - 5 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z")
      : timeIso;
    const plans = await router.plan(from, to, legTime, 5);
    const matching = plans.flatMap((it) => it.legs).filter((l) => {
      if (l.kind !== s.kind) return false;
      if (s.lineOrCarrier && normLine(l.lineOrCarrier) !== normLine(s.lineOrCarrier)) return false;
      return (
        samePlace(l.from, l.fromCoord, s.from, s.fromCoord) &&
        samePlace(l.to, l.toCoord, s.to, s.toCoord)
      );
    });
    const found = matching.length > 0;
    if (!found) {
      reasons.push(
        "segment " + s.index + " : aucune ligne réelle " + s.kind + " « " + s.lineOrCarrier + " » entre « " + s.from + " » et « " + s.to + " » à " + legTime + " (GTFS)",
      );
      continue;
    }
    // Toutes les correspondances/arrêts intermédiaires annoncés doivent être
    // bien desservis par la ligne trouvée (le leg existe VRAIMENT en entier).
    const wanted = s.intermediateStops ?? [];
    if (wanted.length > 0) {
      const stopsOk = matching.some((l) => {
        const served = new Set([l.from, ...l.intermediateStops, l.to]);
        return wanted.every((w) => served.has(w));
      });
      if (!stopsOk) {
        reasons.push(
          "segment " + s.index + " : arrêts intermédiaires non desservis par la ligne « " +
            s.lineOrCarrier + " » (attendus : " + wanted.join(", ") + ")",
        );
      }
    }
  }

  /* ---- 3. Optimalité (contre le meilleur itinéraire réaliste du routeur) ---- */
  const directPlans = await router.plan(endpoints.origin, endpoints.dest, timeIso, 8);
  const bestDirect = selectItinerary(directPlans);
  if (bestDirect) {
    const hasAir = segs.some((s) => s.kind === "air");
    if (!hasAir && journey.totalDurationMin > bestDirect.durationMin + toleranceMin) {
      reasons.push(
        "sous-optimal : " + journey.totalDurationMin + " min retenues vs " + bestDirect.durationMin +
          " min possibles (tolérance " + toleranceMin + " min)",
      );
    }
    if (hasAir && bestDirect.durationMin < journey.totalDurationMin - toleranceMin) {
      // Le candidat avion n'était pas justifié : le direct est plus rapide.
      reasons.push(
        "vol non optimal : le direct fait " + bestDirect.durationMin + " min < " + journey.totalDurationMin + " min",
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}
