// Groupement des arrondissements (GeoNames feature code « PPLX » — section
// of populated place : « Paris 13e Arrondissement », « Lyon 03 »,
// « Marseille 08 », « Wien 1.-Innere Stadt »…) dans leur ville parente.
//
// Objectif de jeu (correction M2) : un clic dans le 13e de Paris doit
// s'aimanter sur « Paris », pas sur « Paris 13e Arrondissement » ; une
// destination ne doit jamais être « Lyon 03 ». L'entrée d'arrondissement
// est renommée du nom de la ville parente (elle garde ses coordonnées, donc
// elle reste une cible de snap fine affichée comme la ville parente).

export interface RawCityLike {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
  featureCode?: string;
}

/**
 * Entrée de type « section de ville » (arrondissement, quartier, district) :
 * - feature code GeoNames « PPLX » (Lyon 03, Wien 1.-Innere Stadt…) ;
 * - nom en « … Arrondissement » (Paris 13e Arrondissement) ;
 * - motif « Ville NN xxx » (quartiers de Paris/Marseille, code PPL :
 *   « Paris 15 Vaugirard », « Marseille 08 »).
 * Le parent est retrouvé par préfixe dans groupArrondissements.
 */
export function isArrondissementSection(c: RawCityLike): boolean {
  if (c.featureCode === "PPLX") return true;
  if (/arrondissement/i.test(c.name)) return true;
  return /^\D+\s+\d{1,2}(er|e|ème|th)?(\s|$)/i.test(c.name);
}

/** `name` commence par `prefix` sur une frontière de mot (« Paris 13e… » → « Paris »). */
function startsWithWord(name: string, prefix: string): boolean {
  const n = name.toLowerCase();
  const p = prefix.toLowerCase();
  return (
    n.startsWith(p) &&
    (n.length === p.length || /[\s\-–—,.]/.test(n.charAt(p.length)))
  );
}

/**
 * Renomme chaque arrondissement de la ville parente trouvée dans le même
 * pays (préfixe du nom, plus grande population). Sans parent trouvé dans le
 * jeu de données, l'entrée est laissée telle quelle.
 */
export function groupArrondissements<T extends RawCityLike>(raw: readonly T[]): T[] {
  const parentsByCountry = new Map<string, T[]>();
  for (const c of raw) {
    if (isArrondissementSection(c)) continue;
    const arr = parentsByCountry.get(c.country) ?? [];
    arr.push(c);
    parentsByCountry.set(c.country, arr);
  }
  return raw.map((c) => {
    if (!isArrondissementSection(c)) return c;
    const parent = (parentsByCountry.get(c.country) ?? [])
      .filter(
        (p) =>
          p.id !== c.id &&
          c.name.length > p.name.length &&
          startsWithWord(c.name, p.name),
      )
      .sort((a, b) => b.population - a.population)[0];
    if (!parent) return c;
    return { ...c, name: parent.name };
  });
}
