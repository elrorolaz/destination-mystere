// M3 — accueil : présentation courte et entrée du jeu.
import Link from "next/link";

const RULES = [
  {
    icon: "🎯",
    title: "6 essais",
    body: "Cliquez une ville sur la carte. Le serveur vous répond par la distance au but.",
  },
  {
    icon: "💡",
    title: "Indices A → E",
    body: "Chaque essai manqué débloque un indice : modes de transport, durées, lignes, compagnies, étape.",
  },
  {
    icon: "🏆",
    title: "Score 1000 → 250",
    body: "Du plein score au premier essai au score de proximité après six échecs.",
  },
];

export default function HomePage() {
  return (
    <main className="dm-home">
      <section className="dm-hero">
        <p className="dm-eyebrow">Un défi par jour · Europe · Transports en commun</p>
        <h1 className="dm-title">
          🧭 Destination <span>Mystère</span>
        </h1>
        <p className="dm-lede">
          Chaque jour, un itinéraire relie une ville française à une mystérieuse
          ville européenne. Vous voyez le départ et la durée totale du
          trajet… à vous de trouver la destination.
        </p>
        <Link className="dm-btn dm-btn-primary" href="/jouer">
          Jouer au défi du jour
        </Link>
      </section>
      <section className="dm-rules">
        {RULES.map((rule) => (
          <article className="dm-rule" key={rule.title}>
            <p className="dm-rule-icon">{rule.icon}</p>
            <h2>{rule.title}</h2>
            <p>{rule.body}</p>
          </article>
        ))}
      </section>
      <footer className="dm-foot">
        <p>
          Nouveau défi chaque jour à minuit, heure de Paris. Une seule partie
          par joueur et par jour.
        </p>
      </footer>
    </main>
  );
}
