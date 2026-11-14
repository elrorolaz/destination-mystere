// Cohérence de la configuration du projet (jalons M0/M1).
// Ces tests figent les décisions structurantes : scripts npm, strictité
// TypeScript, anti-triche de la base, variables d'environnement.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("package.json", () => {
  const pkg = JSON.parse(read("package.json"));

  it("déclare le module ES et Node ≥ 20", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toMatch(">=");
  });

  it("expose les scripts de préparation des données et de base", () => {
    const scripts = pkg.scripts;
    expect(scripts["prepare:cities"]).toBeTruthy();
    expect(scripts["prepare:airports"]).toBeTruthy();
    expect(scripts["prepare:data"]).toBeTruthy();
    expect(scripts["data:import"]).toBeTruthy();
    expect(scripts["db:push"]).toBeTruthy();
    expect(scripts.test).toBeTruthy();
  });
});

describe("tsconfig.json", () => {
  const tsconfig = JSON.parse(read("tsconfig.json"));
  const options = tsconfig.compilerOptions;

  it("active le mode strict complet", () => {
    expect(options.strict).toBe(true);
    expect(options.noUncheckedIndexedAccess).toBe(true);
    expect(options.noImplicitOverride).toBe(true);
  });

  it("autorise les imports relatifs avec extension .ts (scripts Node natifs)", () => {
    expect(options.allowImportingTsExtensions).toBe(true);
  });
});

describe("prisma/schema.prisma", () => {
  const schema = read("prisma/schema.prisma");

  it("interdit deux parties le même jour (anti-triche §7)", () => {
    expect(schema).toContain("@@unique([userId, challengeDate])");
  });

  it("stocke l'itinéraire complet dans le champ pivot journey", () => {
    expect(schema).toContain("journey");
    expect(schema).toContain("DailyChallenge");
    expect(schema).toContain("GameSession");
    expect(schema).toContain("UserStats");
  });

  it("indexe les villes par geohash pour le snap", () => {
    expect(schema).toContain("@@index([geohash])");
  });
});

describe(".env.example", () => {
  const env = read(".env.example");

  it("documente toutes les variables requises", () => {
    expect(env).toContain("DATABASE_URL=");
    expect(env).toContain("SNCF_API_TOKEN=");
    expect(env).toContain("CRON_SECRET=");
    expect(env).toContain("AUTH_SECRET=");
    expect(env).toContain("NEXT_PUBLIC_MAP_TILES_URL=");
  });

  it("documente le fixture de dev (itinéraire figé)", () => {
    expect(env).toContain("DEV_FIXTURE=");
  });
});

describe(".gitignore", () => {
  const gitignore = read(".gitignore");

  it("ignore dépendances, build et secrets", () => {
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".next/");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain("data/tmp/");
  });
});
