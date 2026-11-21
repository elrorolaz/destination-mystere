// PRNG déterministe seedé par la date du défi (spécification §6.2 :
// « PRNG avec la date comme graine → le même duo de villes pour tous,
// reproductible en cas de régénération » ; §10 : la graine vient du serveur,
// jamais du client).
//
// Hachage FNV-1a 32 bits de la clé AAAA-MM-JJ, puis mulberry32.

/** Hache une chaîne en entier 32 bits non signé (FNV-1a). */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (0x01000193), en 32 bits
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** PRNG mulberry32 : rapide, déterministe, distribution uniforme suffisante. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG seedé par une clé de date AAAA-MM-JJ (fuseau Europe/Paris). */
export function prngFromDateKey(dateKey: string): () => number {
  return mulberry32(fnv1a32(dateKey));
}

/** Entier aléatoire dans [min, max] inclus, tiré depuis le PRNG. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Élément aléatoire d'un tableau non vide, ou null si vide. */
export function pick<T>(rng: () => number, arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)] ?? null;
}
