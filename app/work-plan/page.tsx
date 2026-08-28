import type { Metadata } from "next";

import { TeamApplicationForm } from "@/components/hr/team-application-form";
import { PublicPageShell, publicPanelClass } from "@/components/public/public-page-shell";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { readPublicWorkPlanForView } from "@/lib/landing/public-data";
import { readProfileForSessionUser } from "@/lib/waia-core/profiles/runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WAIA Work Plan",
  description: "A read-only view of explicitly public WAIA work.",
};

export default async function WorkPlanPage() {
  const [plan, userId] = await Promise.all([
    readPublicWorkPlanForView(),
    getOptionalSessionUserId(),
  ]);
  const profile = userId ? await readProfileForSessionUser(userId) : null;
  const unavailable = plan.state === "unavailable";

  return (
    <PublicPageShell
      eyebrow="Public work record"
      title="WAIA Work Plan"
      intro="A read-only view of the work currently made public by project and status."
    >
      {unavailable ? (
        <section data-testid="public-work-plan-unavailable" className={publicPanelClass}>
          <h2 className="font-waia-serif text-waia-fg text-xl">Temporarily unavailable</h2>
          <p className="text-waia-fg-muted mt-3 max-w-2xl leading-relaxed">
            The public work plan cannot be loaded right now. No private planning data is shown as a
            fallback.
          </p>
        </section>
      ) : (
        <>
          {plan.state === "stale" ? (
            <p data-testid="public-work-plan-stale" className="text-waia-fg-muted text-sm">
              Showing the last successful public snapshot.
            </p>
          ) : null}
          <div data-testid="public-work-plan-projects" className="flex flex-col gap-7">
            {plan.projects.length === 0 ? (
              <p className={publicPanelClass}>No public work items are available.</p>
            ) : (
              plan.projects.map((project) => (
                <section key={project.name} className={`${publicPanelClass} flex flex-col gap-6`}>
                  <h2 className="font-waia-serif text-waia-fg text-2xl">{project.name}</h2>
                  {project.statuses.map((group) => (
                    <div key={`${group.status.type}:${group.status.label}`}>
                      <h3 className="text-waia-fg-subtle text-xs font-semibold tracking-[0.14em] uppercase">
                        {group.status.label}
                      </h3>
                      <ul className="divide-waia-divider mt-3 divide-y">
                        {group.issues.map((issue) => (
                          <li
                            key={issue.identifier}
                            className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                          >
                            <div>
                              <a
                                href={issue.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-waia-fg decoration-waia-divider duration-waia-base hover:text-waia-accent-warm focus-visible:outline-waia-accent-warm underline underline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
                              >
                                <span className="text-waia-accent-cool mr-2 font-mono text-sm">
                                  {issue.identifier}
                                </span>
                                {issue.title}
                              </a>
                              {issue.dueDate ? (
                                <p className="text-waia-fg-subtle mt-1 text-xs">
                                  Target {issue.dueDate}
                                </p>
                              ) : null}
                            </div>
                            {issue.priorityLabel ? (
                              <span className="text-waia-fg-subtle shrink-0 text-xs">
                                {issue.priorityLabel}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
          {plan.lastSuccessfulSyncAt ? (
            <p className="text-waia-fg-subtle text-xs">
              Last public sync: {plan.lastSuccessfulSyncAt}
            </p>
          ) : null}
        </>
      )}
      <TeamApplicationForm initialName={profile?.displayName} />
    </PublicPageShell>
  );
}
