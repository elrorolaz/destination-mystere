import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "itinaris",
    template: "%s | itinaris",
  },
  description:
    "Chaque jour, un itinéraire en transports en commun relie une ville française à une mystérieuse ville européenne. Saurez-vous la localiser en 6 essais ?",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
