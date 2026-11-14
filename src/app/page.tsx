// M0 — page d'accueil provisoire : le socle démarre, l'écran de jeu arrive en M3.
export default function HomePage() {
  return (
    <main>
      <h1>🧭 Destination Mystère</h1>
      <p>
        Chaque jour, un itinéraire en transports en commun relie une ville
        française à une mystérieuse ville européenne. Vous voyez le départ et
        la durée totale… à vous de trouver la destination en 6 essais.
      </p>
      <p>
        <em>
          Socle M0–M1 en place : données géographiques, index spatial et snap
          validés. Écran de jeu (M3) à venir.
        </em>
      </p>
    </main>
  );
}
