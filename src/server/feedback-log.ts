// Journal des itinéraires signalés « non réalistes » par les joueurs
// (écran de résultat → « ❌ Non »). Objectif : observer les aberrations du
// générateur pour corriger l'algorithme (itinéraires absurdes, durées
// fantaisistes, correspondances impossibles…).
//
// Stockage : fichier JSONL (une ligne JSON par signalement) dans
// data/logs/unrealistic-itineraries.jsonl — dossier gitignoré (donnée
// d'exploitation, pas du code). Le journey journalisé est TOUJOURS relu en
// base par le serveur : jamais de payload client brut.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "unrealistic-itineraries.jsonl");

export interface UnrealisticReport {
  /** Horodatage du signalement (ISO 8601 Z). */
  ts: string;
  /** Date du défi (AAAA-MM-JJ, fuseau Europe/Paris). */
  date: string;
  /** Cookie invité, si présent (corrélation optionnelle). */
  guestKey?: string;
  /** Commentaire libre du joueur (tronqué côté route). */
  comment?: string;
  origin: { id: string; name: string; country: string };
  destination: { id: string; name: string; country: string };
  totalDurationMin: number;
  /** Journey complet du défi, tel que stocké en base. */
  journey: unknown;
}

/** Chemin du fichier de logs (utile pour les tests / l'exploitation). */
export function feedbackLogPath(): string {
  return LOG_FILE;
}

/** Ajoute une ligne JSON au journal (créé le dossier au besoin). */
export function logUnrealisticItinerary(
  report: UnrealisticReport,
  file: string = LOG_FILE,
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(report) + "\n", "utf8");
}
