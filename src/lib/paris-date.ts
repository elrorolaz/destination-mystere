// Date du défi au fuseau Europe/Paris (spécification §1.1, §6, §10).
// Règle anti-triche : le client ne pilote JAMAIS la date. Tout part de
// l'horloge serveur ; « aujourd'hui » signifie « aujourd'hui à Paris ».

/** Clé AAAA-MM-JJ de la date au fuseau Europe/Paris. */
export function parisDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return get("year") + "-" + get("month") + "-" + get("day");
}

/**
 * Horodatage UTC minuit de la clé AAAA-MM-JJ — identifiant Prisma du défi
 * (une seule ligne DailyChallenge par date de Paris).
 */
export function challengeDateFromKey(key: string): Date {
  return new Date(key + "T00:00:00.000Z");
}
