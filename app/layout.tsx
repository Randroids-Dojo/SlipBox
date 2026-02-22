import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SlipBox",
  description: "Cloud-enhanced Zettelkasten engine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
