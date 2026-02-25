import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Buscador Imobiliário",
  description: "Busque imóveis em dezenas de imobiliárias ao mesmo tempo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
