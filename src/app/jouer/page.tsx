// M3 — écran de jeu.
import type { Metadata } from "next";
import GameScreen from "@/components/game/GameScreen";

export const metadata: Metadata = {
  title: "Jouer",
  description:
    "Devinez la destination mystère du jour en six essais, avec la carte de l'Europe.",
};

export default function JouerPage() {
  return <GameScreen />;
}
