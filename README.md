# 🚆 Destination Mystère

Jeu quotidien multi-joueurs : chaque jour, un itinéraire en transports en commun (train, avion, transports publics — jamais de voiture) entre une ville française dotée d'une gare et une ville européenne. Le joueur ne voit que la **ville de départ** et la **durée totale du trajet** ; il localise la destination sur une carte en **6 essais maximum**, avec des indices progressifs :

| Essai manqué | Indice débloqué |
| --- | --- |
| après le 1ᵉʳ | **A** — modes de transport (transports urbains / avion / train) |
| après le 2ᵉ | **B** — modes et durées des segments ensemble |
| après le 3ᵉ | **C** — lignes et compagnies |
| après le 4ᵉ | **D** — compagnies empruntées |
| après le 5ᵉ | **E** — une destination intermédiaire (jamais la dernière ni l'avant-dernière étape) |

Score : 1000 / 850 / 700 / 550 / 400 / 250 points selon le numéro d'essai réussi. La **distance à la destination s'affiche après chaque clic**. En cas d'échec au 6ᵉ essai : **score de proximité** — arrondi de 250 × (1 − d/200), où d est la distance du dernier clic au but, **0 au-delà de 200 km**.

📖 **La spécification complète fait foi : [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md)** (règles, modèle de données, sources, anti-triche, jalons M0–M5).

## Stack

- **Next.js 15** (App Router) + TypeScript strict — application et API dans un seul projet
- **PostgreSQL + Prisma** — 6 modèles (`City`, `DailyChallenge`, `GameSession`, `Guess`, `User`, `UserStats`)
- **MapLibre GL + OpenFreeMap** — fond de carte gratuit sans clé
- **Vitest** — tests unitaires (géographie, snap, configuration, jeu)
- **tsx** — scripts de préparation des données en TypeScript

## État d'avancement

- ✅ **M0 — Socle** : configuration TypeScript stricte, Prisma, scripts de données
- ✅ **M1 — Géographie du jeu** : haversine, geohash (validé contre les ancres publiques), index spatial par geohash avec scan différentiel **exact** (300/300 clics identiques à la force brute, p95 < 0,3 ms), snap clic → ville
- ⬜ **M2 — Génération quotidienne** : PRNG seedé par date, client SNCF/Navitia, estimation aéronautique par distance orthodromique (Amadeus Self-Service étant fermé aux nouveaux comptes depuis juillet 2026), planner, cron avec itinéraire de repli
- ✅ **M3 — Écran de jeu** : carte MapLibre sur fond OpenFreeMap en thème nuit (ouverture à l'échelle de l'Europe, zoom jusqu'au niveau d'une ville et de ses banlieues), boucle de jeu complète en sessions invité, indices A→E servis selon les essais, snap et vérification 100 % serveur (§7), tracé de fin de partie qui **suit les voies ferrées réelles** (OpenStreetMap/Overpass + plus court chemin dans le graphe ferroviaire)
- ⬜ **M4 — Comptes et scores**
- ⬜ **M5 — Finition et déploiement**

## Démarrage rapide (local)

```bash
npm install
cp .env.example .env              # renseigner DATABASE_URL au minimum
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=destination_mystere postgres:16
npm run prepare:data              # télécharge GeoNames + gares SNCF + OpenFlights
npm run db:push                   # crée le schéma Prisma
npm run data:import               # importe les villes
npm run dev                       # http://localhost:3000
npm test                          # tests unitaires
```

## Données préparées

| Fichier | Contenu |
| --- | --- |
| `data/cities/cities.france.json` | villes françaises ≥ 5 000 hab. (GeoNames), avec gare SNCF ≤ 3 km |
| `data/cities/cities.europe.json` | destinations européennes ≥ 5 000 hab. (hors France) — **régénérable, non versionné** (voir ci-dessous) |
| `data/airports/airports.europe.json` | aéroports européens avec code IATA (OpenFlights) |
| `data/fixtures/demo-journey.json` | itinéraire de démonstration figé (voir ci-dessous) |

Dernière génération : **2 076 villes françaises** (dont 1 450 avec gare), **17 857 villes européennes**, **1 031 aéroports**. Aucune clé d'API n'est requise.

> ℹ️ **`cities.europe.json` n'est pas versionné** : c'est une donnée dérivée de ~2,5 Mo (17 857 villes), trop volumineuse pour le dépôt alors qu'elle se régénère à l'identique en ~30 secondes. Après un `git clone`, lancer simplement :
>
> ```bash
> npm run prepare:cities   # recrée cities.france.json (déjà versionné) et cities.europe.json
> ```
>
> Le script et sa logique de filtrage sont bien sûr versionnés (`scripts/prepare-cities.ts`).

## 🎮 Premier test avec un itinéraire fixé

Quatre niveaux, du plus immédiat au plus intégré :

### 0. L'écran de jeu réel (M3)

L'application elle-même est jouable de bout en bout avec l'itinéraire figé :

```bash
npm install
cp .env.example .env             # renseigner DATABASE_URL au minimum
npm run db:push                  # schéma Prisma (dont la colonne guestKey des sessions invité)
npm run prepare:cities           # puis import des villes en base :
npm run data:import
DEV_FIXTURE=true npm run dev     # charge le fixture ci-dessous comme défi du jour
```

Puis ouvrir **http://localhost:3000/jouer**. La carte s'ouvre à l'échelle de l'Europe (fond OpenFreeMap, thème nuit) avec la « constellation » des villes qui s'enrichit au zoom — grandes villes d'abord, puis villes moyennes, jusqu'au niveau d'une ville et de ses **banlieues** (zoom max 16 ; les villes avec gare portent un anneau doré). Départ : Reims, durée totale : 5 h 25. En fin de partie, le tracé de l'itinéraire **suit les voies ferrées réelles** (données OpenStreetMap via Overpass, plus court chemin dans le graphe ferroviaire) pour les segments train et transports urbains ; l'avion est un arc aérien. Un bouton « Rejouer » est disponible en développement (`DELETE /api/session`).

### 1. La maquette jouable (aucune installation)

Une **démo interactive autonome** reproduit fidèlement l'écran de jeu : carte cliquable, snap vers la ville la plus proche, distance au but après chaque clic, 6 essais, indices A→B→C→D→E dans l'ordre, score standard et score de proximité, puis révélation complète (destination, tableau des segments, tracé du trajet). Elle est disponible dans le canvas « Destination Mystère — démo jouable » de la conversation Vibe.

> ⚠️ La maquette embarque un sous-ensemble de villes (≥ 25 000 hab.) et une carte dessinée en Canvas 2D pour rester autonome ; l'application réelle (M3) utilise MapLibre/OpenFreeMap et le seuil complet de 5 000 habitants.

### 2. Le fixture versionné — `data/fixtures/demo-journey.json`

Un itinéraire de démonstration est aussi versionné ici au format `journey` de la spécification (§4) : 9 segments (rail, urban, air, correspondances), durée totale 5 h 25. Structure pivot : tous les indices (A à E) sont des projections de ce JSON, le serveur ne l'envoie **jamais** au client avant la fin de partie. Depuis M3, chaque segment porte en plus des coordonnées d'extrémités (`fromCoord`/`toCoord`) : elles servent uniquement au tracé de fin de partie sur la carte.

### 3. Le chemin déterministe (implémenté en M3)

C'est `src/server/challenge-store.ts` qui le réalise : si aucune ligne `DailyChallenge` n'existe pour la date du jour (fuseau Europe/Paris) et que `DEV_FIXTURE=true`, le fixture est chargé par upsert et rejoué à l'identique pour toutes les parties du jour — déterministe, sans réseau, sans clé. Tolérance : si un identifiant GeoNames du fixture manque en base, repli sur une résolution par nom de ville. C'est aussi la structure attendue pour l'**itinéraire de repli** du cron M2 : en cas d'échec de l'API SNCF, la génération quotidienne tombera sur un itinéraire pré-calculé du même format.

## Tests

```bash
npm test
```

**59 tests** couvrent :

- la configuration (scripts, strictité, anti-triche Prisma), le geohash (ancres publiques Wikipédia), le haversine et le snap (exactitude contre la force brute sur 300 clics, p95 < 2 ms) — 36 tests des jalons M0–M1 ;
- **M3 (+23)** : le score standard et le score de proximité, la projection des indices A→E sur le fixture (dont le cas dégradé sans arrêts intermédiaires), le graphe ferroviaire (fusion des nœuds partagés, plus court chemin, Douglas-Peucker, arc aérien) et l'**état public anti-triche** (destination et journey invisibles tant que la partie est ACTIVE, distance au but par proposition).

Le cluster de test autour de Reims documente la découverte M1 §11.5 : des communes de 5 000–10 000 hab. captent les clics autour des grandes villes.

## Scripts npm

| Script | Rôle |
| --- | --- |
| `prepare:cities` / `prepare:airports` / `prepare:data` | téléchargent et préparent GeoNames, gares SNCF, OpenFlights |
| `data:import` | importe les villes dans PostgreSQL |
| `db:push` / `db:migrate` / `db:generate` / `db:studio` | Prisma |
| `dev` / `build` / `start` | Next.js |
| `test` / `test:watch` | Vitest |
