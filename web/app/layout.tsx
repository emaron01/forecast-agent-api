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
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
