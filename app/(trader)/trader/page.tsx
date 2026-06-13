import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI-TRADER",
  description: "AI-TRADER workspace.",
};

export default function TraderDashboardPage() {
  return (
    <div
      data-testid="trader-workspace"
      className="bg-background flex min-h-screen flex-col px-6 py-10 md:px-10"
    >
      <header className="border-border mb-10 border-b pb-6">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA Module</p>
        <h1
          data-testid="trader-workspace-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          AI-TRADER
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">Trader Workspace</p>
      </header>

      <div className="grid flex-1 gap-4 md:grid-cols-3">
        <section
          data-testid="trader-placeholder-exchange"
          className="border-border bg-muted/30 rounded-lg border p-6"
        >
          <h2 className="text-sm font-medium">Exchange</h2>
          <p className="text-muted-foreground mt-2 text-sm">No exchange connected</p>
        </section>

        <section
          data-testid="trader-placeholder-portfolio"
          className="border-border bg-muted/30 rounded-lg border p-6"
        >
          <h2 className="text-sm font-medium">Portfolio</h2>
          <p className="text-muted-foreground mt-2 text-sm">Portfolio coming soon</p>
        </section>

        <section
          data-testid="trader-placeholder-strategies"
          className="border-border bg-muted/30 rounded-lg border p-6"
        >
          <h2 className="text-sm font-medium">Strategies</h2>
          <p className="text-muted-foreground mt-2 text-sm">Strategies coming soon</p>
        </section>
      </div>
    </div>
  );
}
