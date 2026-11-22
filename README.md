# 🚆 Destination Mystère

Jeu quotidien multi-joueurs : chaque jour, un itinéraire en transports en commun (train, avion, transports publics — jamais de voiture) entre une ville française dotée d'une gare et une ville européenne. Le joueur ne voit que la **ville de départ** et la **durée totale du trajet** ; il localise la destination sur une carte en **6 essais maximum**, avec des indices progressifs :

| Essai manqué | Indice débloqué |
| --- | --- |
| après le 1ᵉʳ | **A** — modes de transport (transports urbains / avion / train) |
| après le 2ᵉ | **B** — modes et durées des segments ensemble |
| après le 3ᵉ | **C** — lignes et compagnies |
| après le 4ᵉ | **D** — une destination intermédiaire (jamais la dernière ni l'avant-dernière étape) |
| essais 5 et 6 | aucun nouvel indice : deux essais « nus » après l'indice D |

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
- ✅ **M2 — Génération quotidienne** : PRNG seedé par date (`prng.ts`), client SNCF/Navitia (`sncf.ts`, Basic auth, horaires théoriques), estimation aéronautique par distance orthodromique entre aéroports majeurs (§5.2, `flights.ts`), planner rail-vs-avion (`planner.ts`), cron `POST /api/cron/generate-daily` protégé par `CRON_SECRET` (génère J et J+1, idempotent, repli sur le fixture), CLI `npm run challenge:generate`
- ✅ **M3 — Écran de jeu** : carte MapLibre sur fond OpenFreeMap en thème nuit (ouverture à l'échelle de l'Europe, zoom jusqu'au niveau d'une ville et de ses banlieues), boucle de jeu complète en sessions invité, indices A→E servis selon les essais, snap et vérification 100 % serveur (§7), tracé de fin de partie qui **suit les voies ferrées réelles** (OpenStreetMap/Overpass + plus court chemin dans le graphe ferroviaire)
- ✅ **M3+ — Design de la carte** : **deux fonds retenus, mode jour/nuit** — bouton ☀️/🌙 en haut de l'écran de jeu : A « Nuit étoilée » (nuit) et D « Jour papier » (jour), choix persisté en localStorage (défaut = préférence système `prefers-color-scheme`), palettes de jeu adaptées clair/sombre (`src/components/map/map-themes.ts`) ; **clusters d'agglomérations (règle des 15 km)** : chaque ville est rattachée à la ville la plus peuplée dans un rayon de 15 km — **seule la référence du cluster est affichée et cliquable** (snap serveur et `/api/cities` filtrent via `src/lib/geo/clusters.ts` ; le tirage du défi ne choisit que des références) ; **étiquettes des villes intermédiaires plus tôt** (paliers zoom/population abaissés) ; **tracé final très marqué** (halo large + cœur épais de couleur vive : rose `#FF2D55` en nuit, rouge `#D50000` en jour) ; **confirmation avant validation d'un clic** (popup « Proposer X ? » + Valider/Annuler, snap public via `GET /api/snap`) ; écran de résultat dans le **panneau latéral** (la carte et le tracé restent visibles). Le tracé ferroviaire suit les voies réelles via **Overpass, et en repli via la géométrie réelle du leg rejouée auprès du routeur MOTIS** (`legGeometry`, `npm run check:leg-geometry`) quand Overpass est indisponible ; si les deux sont indisponibles, le repli est une **courbe de Bézier douce** (`smoothArc`, bombée vers le nord) et non plus une ligne droite anguleuse. **Aéroports : uniquement les internationaux MAJEURS** (`isMajorAirport` : large_airport ou hub ≥ 150 000 hab. — `planner.ts` utilise `majorAirportFor`, plus de petit aérodrome régional dans un trajet)
- ⬜ **M4 — Comptes et scores**
- ⬜ **M5 — Finition et déploiement**

## Démarrage rapide (local)

```bash
npm install
cp .env.example .env              # renseigner DATABASE_URL au minimum
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=destination_mystere postgres:16
npm run prepare:data              # télécharge GeoNames + gares SNCF + OurAirports
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
| `data/airports/airports.europe.json` | **aéroports internationaux uniquement** (OurAirports `large_airport` + `medium_airport` à service régulier, code IATA, pays ISO, ville-hub) |
| `data/fixtures/demo-journey.json` | itinéraire de démonstration figé (voir ci-dessous) |

Dernière génération : **2 076 villes françaises** (dont 1 450 avec gare, arrondissements/quartiers regroupés dans leur ville parente : un clic dans le 13e de Paris s'affiche « Paris »), **17 913 villes européennes**, **572 aéroports internationaux** (54 pays). Aucune clé d'API n'est requise.

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

Un itinéraire de démonstration est aussi versionné ici au format `journey` de la spécification (§4) : 9 segments (rail, urban, air, correspondances), durée totale 5 h 25. Structure pivot : tous les indices (A à D) sont des projections de ce JSON, le serveur ne l'envoie **jamais** au client avant la fin de partie. Depuis M3, chaque segment porte en plus des coordonnées d'extrémités (`fromCoord`/`toCoord`) : elles servent uniquement au tracé de fin de partie sur la carte.

### 3. Le chemin déterministe (implémenté en M3)

C'est `src/server/challenge-store.ts` qui le réalise : si aucune ligne `DailyChallenge` n'existe pour la date du jour (fuseau Europe/Paris) et que `DEV_FIXTURE=true`, le fixture est chargé par upsert et rejoué à l'identique pour toutes les parties du jour — déterministe, sans réseau, sans clé. Tolérance : si un identifiant GeoNames du fixture manque en base, repli sur une résolution par nom de ville. C'est aussi la structure attendue pour l'**itinéraire de repli** du cron M2 : en cas d'échec de l'API SNCF, la génération quotidienne tombera sur un itinéraire pré-calculé du même format.

### 4. Génération quotidienne réelle (implémenté en M2)

```bash
# 1) Renseigner dans .env :
#    SNCF_API_TOKEN=...   # token gratuit https://digital.sncf.com/startup/api/token
#    CRON_SECRET=...      # protège la route cron
# 2) Générer le défi du jour (et J+1) — en local comme en cron :
npm run challenge:generate                 # aujourd'hui (Europe/Paris)
npm run challenge:generate -- --date 2026-11-22
# 3) Ou laisser le cron appeler la route (vercel.json : 05:00 Europe/Paris) :
#    POST /api/cron/generate-daily  avec  Authorization: Bearer $CRON_SECRET
```

- **Sélection déterministe** : PRNG seedé par la clé de date → le même duo de villes pour tous ; relancer deux fois donne le même duo (testé). **40 % des itinéraires sont sans avion** (`NO_AIR_PROBABILITY` : zone France ou Europe proche, 100 % train) ; sinon Europe avec avion (≥ 600 km). Départ avec gare, bornes de distance selon la zone. Les réessais d'une même date restent dans la zone/mode tirés (`forceZone`/`forceAllowAir`, jusqu'à 10 paires) — sinon les rejets de planification feraient retomber systématiquement sur du France (`npm run diagnose:zone` pour diagnostiquer). Aéroport retenu = **majeur le plus proche** (`majorAirportFor` filtré `isMajorAirport`, critère distance et non hub le plus peuplé — sinon les accès au sol rendent l'itinéraire irréaliste), `minAirKm` 450, portées 200/300 km.
- **Itinéraires RÉELS** : calculés par un routeur GTFS réel, **Transitous/MOTIS** (`api.transitous.org`, aucune clé requise, couverture Europe dont SNCF/Transilien) — plan gare → gare. `ROUTER=navitia` + `SNCF_API_TOKEN` permet d'utiliser l'API SNCF/Navitia à la place. Le `planner.ts` compare le porte-à-porte direct vs le trajet **avion** : pour un trajet long entre pays différents, il cherche l'**aéroport international le plus proche du départ (A)** et **de l'arrivée (B)** (dataset filtré internationaux uniquement), applique **deux fois** la méthode de calcul d'itinéraire (origine → aérogare A, puis aérogare B → arrivée, chacune routée en GTFS avec repli gare de la ville-hub + navette aéroport estimée), et concatène : `départ → A → vol A→B → B → arrivée`. Le vol est estimé §5.2 (distance/800 km/h + 35 min) entre vrais codes IATA, la compagnie est choisie selon le pays d'arrivée — et **jamais de vol France → France** (zone FR = 100 % rail). Le plus « optimal » gagne : **moins de correspondances d'abord, puis le plus rapide** (garde-fou : si le « moins de correspondances » est > 2× plus lent, on prend le plus rapide). Chaque leg de transport reste un segment à part : un « TER + TGV » avec correspondance n'est jamais aplati.
- **Vérification avant publication** (`verify.ts`) : un itinéraire n'est stocké que s'il est (1) **chaîné** (chaque segment part où le précédent arrive, ≤ 3 km), (2) **existant réellement** — chaque leg rail/urban est rejoué auprès du routeur **à son propre horaire de départ** (pas à 08:00) et la ligne doit exister dans les GTFS en desservant **tous les arrêts intermédiaires annoncés** (toutes les correspondances sont vérifiées) ; les vols sont validés contre le dataset d'aéroports internationaux IATA + durée de vol vraisemblable ; durée totale ≤ 12 h — et (3) **optimal** — pas plus lent que le meilleur itinéraire réaliste du routeur. Sinon, on essaie la paire seedée suivante (jusqu'à 5), puis repli fixture (§6.5).
- **Cas d'usage vérifié** : `npm run check:itinerary -- Rennes "Mantes-la-Jolie"` propose bien **TGV INOUI Rennes → Paris Montparnasse + Transilien N → Mantes-la-Jolie** (avec les vrais arrêts intermédiaires) et le verdict « RÉALISTE et OPTIMAL ».
- **Repli** (§6.5) : si la génération échoue, le fixture `data/fixtures/demo-journey.json` est chargé à la place ; le cron génère aussi J+1 en avance.

### 5. Itinéraires de test aléatoires (implémenté en M3)

```bash
DEV_FIXTURE=random npm run dev   # http://localhost:3000/jouer
```

Avec `DEV_FIXTURE=random`, si aucun défi n'existe pour aujourd'hui, un itinéraire **aléatoire mais RÉEL et VÉRIFIÉ** est généré : une paire aléatoire (zone 50/50 France/Europe) est planifiée par le **vrai planner** (routeur GTFS + vérification M2, comme en production) ; en repli hors-ligne seulement, le générateur synthétique `dev-journey-pure.ts` est utilisé. Le bouton **🎲 Nouvel itinéraire** (visible en développement, barre du haut et écran de fin) appelle `POST /api/dev/reroll` : nouveau tirage, remplacement du défi du jour, remise à zéro des parties du jour **et de la carte** (épingles et tracés effacés) — pratique pour tester plusieurs itinéraires à la suite.

Méthodologie de réalisme du tirage aléatoire (identique à la production, cf. §M2 ci-dessus) :

- **40 % sans avion** (`rand() < 0.4`) : destination en France (100 % rail) ou Europe proche en train ; sinon Europe avec avion ;
- **vol uniquement entre aéroports internationaux** (`data/airports/airports.europe.json`, large/medium OurAirports à service régulier) : les plus proches du départ et de l'arrivée, avec accès au sol calculés par le routeur (repli gare de la ville-hub + navette) ; la compagnie est choisie selon le pays d'arrivée (Turkish Airlines vers la Turquie, Lufthansa vers l'Allemagne…) ;
- **chaque leg de transport est un segment séparé** : TER + TGV avec correspondance restent deux segments (jamais aplatis), étiquetés selon la vraie ligne (RER B, Transilien N, DLR, ICE…) ;
- **vérification** : chaque leg est rejoué à son horaire réel contre les GTFS avant publication ;
- en fin de partie, les tronçons rail/urban suivent les **voies ferrées réelles** d'OpenStreetMap (Overpass : rail, tram, métro, light_rail) quand l'API est joignable, sinon ligne droite indicative.

## Tests

```bash
npm test
```

**140 tests** couvrent :

- la configuration (scripts, strictité, anti-triche Prisma), le geohash (ancres publiques Wikipédia), le haversine et le snap (exactitude contre la force brute sur 300 clics, p95 < 2 ms) — 36 tests des jalons M0–M1 ;
- **M2 (+61)** : le PRNG seedé par date (déterminisme), la sélection déterministe du duo (contraintes de zone/distance/gare), les **aéroports internationaux uniquement** (sélection par proximité, hub, compagnie par pays), l'estimation des vols (§5.2 : distance/800 km/h + 35 min), le client Navitia, le client Transitous (normalisation MOTIS, labels RER/Transilien/DLR, sélection « moins de correspondances d'abord », chaînage START/END des itinéraires concaténés), le **planner avion** (départ→aéroport A→vol A→B→aéroport B→arrivée, concaténation, navette aéroport, jamais FR→FR), la **vérification par leg** (rejeu à l'horaire réel du segment, arrêts intermédiaires desservis, chaînage, durée max, optimalité) et le **groupement des arrondissements** (PPLX/PPL « Ville NN ») ;
- **M3 (+23)** : le score standard et le score de proximité, la projection des indices A→D sur le fixture (dont le cas dégradé sans arrêts intermédiaires), le graphe ferroviaire (fusion des nœuds partagés, plus court chemin, Douglas-Peucker, arc aérien), l'état public anti-triche (destination et journey invisibles tant que la partie est ACTIVE, distance au but par proposition) et le générateur aléatoire de test (itinéraires réalistes : vrais IATA, compagnies selon le pays, 50/50 FR/EU).

Le cluster de test autour de Reims documente la découverte M1 §11.5 : des communes de 5 000–10 000 hab. captent les clics autour des grandes villes.

## Scripts npm

| Script | Rôle |
| --- | --- |
| `prepare:cities` / `prepare:airports` / `prepare:data` | téléchargent et préparent GeoNames, gares SNCF, aéroports internationaux OurAirports |
| `data:import` | importe les villes dans PostgreSQL |
| `challenge:generate` | génère le défi du jour en CLI (même code que le cron M2) |
| `check:itinerary` | vérifie un itinéraire réel entre deux villes (ex. `npm run check:itinerary -- Rennes "Mantes-la-Jolie"`) |
| `db:push` / `db:migrate` / `db:generate` / `db:studio` | Prisma |
| `dev` / `build` / `start` | Next.js |
| `test` / `test:watch` | Vitest |
