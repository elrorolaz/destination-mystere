# 🚆 Destination Mystère

Jeu quotidien multi-joueurs : chaque jour, un itinéraire en transports en commun (train, avion, transports publics — jamais de voiture) entre une ville française dotée d'une gare et une ville européenne. Le joueur ne voit que la **ville de départ** et la **durée totale du trajet** ; il localise la destination sur une carte en **6 essais maximum**, avec des indices progressifs :

| Essai manqué | Indice débloqué |
| --- | --- |
| après le 1ᵉʳ | **A** — modes de transport du trajet |
| après le 2ᵉ | **B** — durées des segments |
| après le 3ᵉ | **C** — lignes et compagnies |
| après le 4ᵉ | **D** — un arrêt intermédiaire |

Score : 1000 / 850 / 700 / 550 / 400 / 250 points selon le numéro d'essai réussi ; échec = 0.

📖 **La spécification complète fait foi : [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md)** (règles, modèle de données, sources, anti-triche, jalons M0–M5).

## Stack

- **Next.js 15** (App Router) + TypeScript strict — application et API dans un seul projet
- **PostgreSQL + Prisma** — 6 modèles (`City`, `DailyChallenge`, `GameSession`, `Guess`, `User`, `UserStats`)
- **MapLibre GL + OpenFreeMap** — fond de carte gratuit sans clé
- **Vitest** — tests unitaires (géographie, snap, configuration)
- **tsx** — scripts de préparation des données en TypeScript

## État d'avancement

- ✅ **M0 — Socri** : configuration TypeScript stricte, Prisma, scripts de données
- ✅ **M1 — Géographie du jeu** : haversine, geohash (validé contre les ancres publiques), index spatial par geohash avec scan différentiel **exact** (300/300 clics identiques à la force brute, p95 < 0,3 ms), snap clic → ville
- ⬜ **M2 — Génération quotidienne** : PRNG seedé par date, client SNCF/Navitia, estimation aéronautique par distance orthodromique (Amadeus Self-Service étant fermé aux nouveaux comptes depuis juillet 2026), planner, cron avec itinéraire de repli
- ⬜ **M3 — Écran de jeu** : carte MapLibre, boucle de jeu, indices
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
| `data/cities/cities.europe.json` | destinations européennes ≥ 5 000 hab. (hors France) |
| `data/airports/airports.europe.json` | aéroports européens avec code IATA (OpenFlights) |
| `data/fixtures/demo-journey.json` | itinéraire de démonstration figé (voir ci-dessous) |

Dernière génération : **2 076 villes françaises** (dont 1 450 avec gare), **17 857 villes européennes**, **1 031 aéroports**. Les fichiers sont régénérables à tout moment via `npm run prepare:data` (aucune clé d'API requise).

## 🎮 Premier test avec un itinéraire fixé

Trois niveaux de test, du plus immédiat au plus intégré :

### 1. La maquette jouable (aucune installation)

Une **démo interactive autonome** reproduit fidèlement l'écran de jeu : carte cliquable, snap vers la ville la plus proche, 6 essais, indices A→B→C→D dans l'ordre, score standard, puis révélation complète (destination, tableau des segments, tracé du trajet). Elle est disponible dans le canvas « Destination Mystère — démo jouable » de la conversation Vibe.

> ⚠️ La maquette embarque un sous-ensemble de villes (≥ 25 000 hab.) et une carte dessinée en Canvas 2D pour rester autonome ; la vraie application (M3) utilisera MapLibre/OpenFreeMap et le seuil complet de 5 000 habitants.

### 2. Le fixture versionné — `data/fixtures/demo-journey.json`

L'itinéraire de la maquette est aussi versionné ici au format `journey` de la spécification (§4) : 9 segments (rail, urban, air, correspondances), durée totale 5 h 25. Structure pivot : tous les indices (A, B, C, D) sont des projections de ce JSON, le serveur ne l'envoie **jamais** au client avant la fin de partie.

### 3. Le chemin déterministe dans la vraie application (M2/M3)

Quand la boucle serveur existera, ce même fichier permettra des tests reproductibles sans appeler d'API externe :

1. `DEV_FIXTURE=true npm run dev`
2. Si aucune ligne `DailyChallenge` n'existe pour la date du jour, la route de développement charge `data/fixtures/demo-journey.json` (au lieu du cron/API SNCF).
3. Toutes les parties du jour rejouent alors l'itinéraire figé — déterministe, sans réseau, sans clé.

C'est aussi la structure attendue pour l'**itinéraire de repli** du cron M2 : en cas d'échec de l'API SNCF, la génération quotidienne tombera sur un itinéraire pré-calculé du même format.

## Tests

```bash
npm test
```

36 tests couvrent la configuration (scripts, strictité, anti-triche Prisma), le geohash (ancres publiques Wikipédia), l'haversine (distances de référence, point à azimut donné) et le snap (exactitude contre la force brute sur 300 clics, p95 < 2 ms). Le cluster de test autour de Reims documente la découverte M1 §11.5 : des communes de 5 000–10 000 hab. captent les clics autour des grandes villes.

## Scripts npm

| Script | Rôle |
| --- | --- |
| `prepare:cities` / `prepare:airports` / `prepare:data` | téléchargent et préparent GeoNames, gares SNCF, OpenFlights |
| `data:import` | importe les villes dans PostgreSQL |
| `db:push` / `db:migrate` / `db:generate` / `db:studio` | Prisma |
| `dev` / `build` / `start` | Next.js |
| `test` / `test:watch` | Vitest |
