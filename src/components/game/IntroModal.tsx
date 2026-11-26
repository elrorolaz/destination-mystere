"use client";

// Écran d'accueil du jeu (UX) : s'affiche à l'ouverture de la partie (et après
// un 🎲 nouvel itinéraire) pour présenter le départ, la durée du trajet et les
// règles. Un clic EN DEHORS de la fenêtre (sur le fond) accède directement à
// l'écran de jeu.

import Image from "next/image";
import type { PublicChallengeState } from "@/lib/game-types";
import { formatDuration } from "@/lib/format/duration";
import { formatDestTier } from "@/lib/format/difficulty";

export default function IntroModal({
  state,
  onClose,
}: {
  state: PublicChallengeState;
  onClose: () => void;
}) {
  return (
    <div
      className="dm-modal-backdrop"
      onClick={onClose}
      role="presentation"
      aria-label="Fond : cliquez pour passer au jeu"
    >
      <div
        className="dm-modal dm-intro"
        role="dialog"
        aria-modal="true"
        aria-label="Présentation du défi du jour"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src="/logo.jpeg"
          alt="Logo Itinaris"
          width={360}
          height={216}
          className="dm-intro-logo"
          priority
        />
        <p className="dm-intro-eyebrow">🧭 Défi du {state.date}</p>
        <h2 className="dm-intro-title">Où mène cet itinéraire ?</h2>
        <p className="dm-intro-journey">
          Itinéraire <strong>{state.routeIndex} / {state.routeCount}</strong> — départ :{" "}
          <strong>{state.origin.name}</strong> ({state.origin.country})
          <br />
          Durée du trajet :{" "}
          <strong>{formatDuration(state.totalDurationMin)}</strong> portes-à-portes
          <br />
          Niveau : destinations possibles parmi les <strong>{formatDestTier(state.destMinPopulation)}</strong>
          {" "}(score ×{state.routeMultiplier})
        </p>
        <ul className="dm-intro-rules">
          <li>
            🖱️ <strong>Cliquez sur la carte</strong> pour proposer une
            destination — 6 essais maximum.
          </li>
          <li>
            📏 Après chaque essai, l&apos;épingle indique la{" "}
            <strong>distance au but</strong> (« à X km »).
          </li>
          <li>
            🔓 Chaque essai manqué débloque un <strong>indice</strong> (A → E :
            modes, durées, lignes, étape intermédiaire, pays de la destination
            après le 5ᵉ essai — il ne reste alors qu&apos;un seul essai).
          </li>
          <li>
            🏆 Jusqu&apos;à <strong>1000 points</strong> au 1ᵉʳ essai (score ×1,5 sur le
            2ᵉ itinéraire, ×2 sur le 3ᵉ), puis score de proximité si les 6
            essais sont épuisés.
          </li>
          <li>
            🧭 La journée se joue en <strong>{state.routeCount} itinéraires</strong> :
            le score final est le total des trois.
          </li>
        </ul>
        <button type="button" className="dm-btn dm-btn-primary" onClick={onClose}>
          C&apos;est parti !
        </button>
        <p className="dm-modal-hint">Cliquez en dehors de cette fenêtre pour jouer.</p>
      </div>
    </div>
  );
}
