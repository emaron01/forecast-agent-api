import dynamic from "next/dynamic";

export const runtime = "nodejs";

const TestExecutiveDashboard = dynamic(
  () => import("../../components/test-dashboard/TestExecutiveDashboard").then((m) => m.TestExecutiveDashboard),
  {
    ssr: false,
    loading: () => (
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6">
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Loading sandbox dashboard…</div>
          <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Client-only render to avoid hydration mismatches.</div>
        </div>
      </main>
    ),
  }
);

export default function TestDashboardPage() {
  return <TestExecutiveDashboard />;
}

