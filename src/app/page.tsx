// La page d'accueil n'existe plus : on atteint directement l'écran de jeu
// (avec son panneau de démarrage) via une redirection serveur.
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/jouer");
}
