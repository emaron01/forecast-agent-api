import "./globals.css";

export const metadata = {
  title: "Forecast Agent",
  description: "Contract-based ingestion + opportunities + audit events",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[color:var(--sf-background)] text-[color:var(--sf-text-primary)]">{children}</body>
    </html>
  );
}
