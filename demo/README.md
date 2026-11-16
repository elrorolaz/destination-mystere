# Destination Mystère — démo jouable autonome

`destination-mystere-demo.md` est l'export exact de la maquette jouable
« Destination Mystère » construite dans un canvas Vibe (type `react`).
Le fichier est **autonome** : tout le nécessaire est embarqué.

## Contenu embarqué

- **19 937 villes** GeoNames ≥ 5 000 hab. (seuil complet du jeu, §1.2),
  bbox + codes pays de `scripts/lib/europe.ts` ;
- **1 450 villes** françaises avec gare SNCF à ≤ 3 km (hors Corse) ;
- **453 villes** européennes rattachées à un aéroport
  (`data/airports/airports.europe.json`, ≤ 45 km, pop ≥ 150 k) ;
- 69 anneaux de littoral Natural Earth 110m ;
- le tout compressé gzip + base64, décompressé au runtime
  (`DecompressionStream`), soit ~4 700 lignes de données.

## Jouer / prévisualiser

- **Vibe** : créer un canvas React et coller le contenu du fichier
  (frontmatter inclus) — le rendu Tailwind est fourni par le runtime.
- Hors Vibe : extraire le code sous le frontmatter dans un bac à sable
  React **avec Tailwind** ; aucune autre dépendance (pas de réseau,
  pas de build).

## Règles de la maquette (v5)

- 6 essais ; indices **A → B → C → D**, un par échec (1er, 2e, 3e,
  4e), puis **deux derniers essais** après l'indice D ;
- tirage **préalable** de la zone : France (2/5, itinéraire 100 % rail)
  ou reste de l'Europe (3/5, vol via Paris-CDG) ;
- graine du jour = `AAAAMMJJ` (défi quotidien déterministe) ;
  bouton 🎲 = graine aléatoire ;
- score standard 1 000 → 250, score de proximité §1.3.

## Itinéraires ferroviaires réalistes (v5)

Un segment n'est étiqueté **TGV** que si ses **deux extrémités** sont
des gares TGV réelles (liste curatée d'environ 50 gares, minimale par
prudence : Sarcelles ou Châteauroux n'y figurent pas). Sinon :
TER (< 150 km) ou Intercités (≥ 150 km). Une ville sans gare TGV part
en navette TER vers la gare TGV la plus proche (ex. Colmar → TER
Mulhouse → TGV Paris-Est). Les correspondances parisiennes utilisent
la **gare réelle du corridor** (Nord, Est, Lyon, Montparnasse) avec
transfert métro. L'étape de l'indice D est choisie **uniquement parmi
les gares TGV** sur un tronc TGV.

## Améliorations antérieures incluses

- clic rattaché à la ville la plus proche **en espace écran** (bug v1
  de projection Mercator inversée corrigé) ;
- zoom écran jusqu'à ~600 000 px/monde (~22 px/km à zoom max), noms de
  villes affichés à fort zoom avec anti-chevauchement ;
- fond de carte en dégradés, côtes liserées, halos lumineux sur les
  grandes villes.

## Limites connues

- L'étape de l'indice D est la gare TGV réelle la plus proche du milieu
  du segment **à vol d'oiseau** : dans les corridors de montagne
  (ex. Lyon → Nice), elle peut nommer une gare hors de la ligne réelle.
  Un graphe ferroviaire réel serait nécessaire pour corriger.
- Durées synthétiques (modèle vitesse par mode) ; dans l'application
  réelle (jalon M3), le serveur fait autorité (§7 anti-triche).

## Suivis à trancher côté repo

1. `SPECIFICATION.md` §1.1 impose une destination « hors France » ;
   la maquette autorise désormais des destinations en France (tirage
   2/5). Décider : mettre à jour la spécification ou contraindre le
   tirage.
2. ✅ **Résolu en M3** : le fixture utilise l'identifiant GeoNames
   correct de Reims (`2984114`) et le chargeur de fixture
   (`src/server/challenge-store.ts`) prévoit un repli par nom de
   ville si un identifiant manque en base.
