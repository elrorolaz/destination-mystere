"use client";

// Écran d'accueil du jeu (UX) : s'affiche à l'ouverture de la partie (et après
// un 🎲 nouvel itinéraire) pour présenter le départ, la durée du trajet et les
// règles. Un clic EN DEHORS de la fenêtre (sur le fond) accède directement à
// l'écran de jeu.

import Image from "next/image";
import type { PublicChallengeState } from "@/lib/game-types";
import { formatDuration } from "@/lib/format/duration";

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
          alt="Logo Destination Mystère"
          width={360}
          height={216}
          className="dm-intro-logo"
          priority
        />
        <p className="dm-intro-eyebrow">🧭 Défi du {state.date}</p>
        <h2 className="dm-intro-title">Où mène cet itinéraire ?</h2>
        <p className="dm-intro-journey">
          Départ : <strong>{state.origin.name}</strong> ({state.origin.country})
          <br />
          Durée du trajet :{" "}
          <strong>{formatDuration(state.totalDurationMin)}</strong> portes-à-portes
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
            🔓 Chaque essai manqué débloque un <strong>indice</strong> (A → D :
            modes, durées, lignes, étape intermédiaire).
          </li>
          <li>
            🏆 Jusqu&apos;à <strong>1000 points</strong> au 1ᵉʳ essai, puis score de
            proximité si les 6 essais sont épuisés.
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
