// Importe les villes préparées (data/cities/*.json) dans PostgreSQL via
// Prisma. Les aéroports restent un fichier statique versionné (aucun modèle
// de base à ce stade — ils servent à l'estimation des vols au jalon M2).
//
//   npm run data:import   (nécessite DATABASE_URL et `npm run db:push`)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { CityRecord } from "../src/lib/geo/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const prisma = new PrismaClient();

async function main() {
  const france = JSON.parse(
    readFileSync(`${ROOT}data/cities/cities.france.json`, "utf8"),
  ) as CityRecord[];
  const europe = JSON.parse(
    readFileSync(`${ROOT}data/cities/cities.europe.json`, "utf8"),
  ) as CityRecord[];

  // Déduplique par id (la France figure dans les deux fichiers) en gardant
  // la fiche la plus riche (hasTrainStation).
  const byId = new Map<string, CityRecord>();
  for (const city of [...europe, ...france]) {
    const prev = byId.get(city.id);
    if (!prev || (!prev.hasTrainStation && city.hasTrainStation)) {
      byId.set(city.id, city);
    }
  }

  const BATCH = 500;
  const rows = [...byId.values()].map((city) => ({
    id: city.id,
    name: city.name,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
    population: city.population,
    hasTrainStation: city.hasTrainStation,
    geohash: city.geohash,
  }));

  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.city.createMany({
      data: rows.slice(i, i + BATCH),
      skipDuplicates: true,
    });
    process.stdout.write(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }

  const total = await prisma.city.count();
  const withStation = await prisma.city.count({ where: { hasTrainStation: true } });
  console.log(`✅ ${total} villes importées (${withStation} avec gare).`);
}

main()
  .catch((error) => {
    console.error("Échec de l'import :", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
