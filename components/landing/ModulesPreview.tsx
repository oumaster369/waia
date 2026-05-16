type ModuleCard = {
  id: string;
  name: string;
  description: string;
  role: string;
};

const MODULES: ReadonlyArray<ModuleCard> = [
  {
    id: "ai-twin",
    name: "AI-Twin",
    description:
      "Your personal digital twin that grows through dialogue and—later—diary-style reflection.",
    role: "Personal intelligence layer in the WAIA ecosystem. Available right after you sign in.",
  },
  {
    id: "3p-business",
    name: "3P (Business)",
    description: "The WAIA business layer built around Provision, Promotion, and Production.",
    role: "For companies and teams. Connects in a later phase.",
  },
  {
    id: "ai-marketplace",
    name: "AI-Marketplace",
    description: "The economic and marketplace layer of the WAIA ecosystem.",
    role: "For value exchange between AI-Twins and businesses. Connects in a later phase.",
  },
];

export function ModulesPreview() {
  return (
    <section
      data-testid="landing-modules"
      aria-label="WAIA modules preview"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-6 font-sans sm:py-10"
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
        {MODULES.map((module) => (
          <article
            key={module.id}
            data-testid={`landing-module-${module.id}`}
            className="flex flex-col gap-3 rounded-xl border border-waia-accent-warm-muted/15 bg-waia-field/40 p-6 text-waia-fg-muted backdrop-blur-[var(--waia-blur-veil-sm)]"
          >
            <h2 className="text-lg font-semibold text-waia-accent-cool-muted">
              {module.name}
            </h2>
            <p
              data-testid={`landing-module-${module.id}-description`}
              className="text-sm font-normal text-waia-fg-muted"
            >
              {module.description}
            </p>
            <p
              data-testid={`landing-module-${module.id}-role`}
              className="text-sm font-normal text-waia-fg-subtle"
            >
              {module.role}
            </p>
            {module.id !== "ai-twin" && (
              <p
                data-testid={`landing-module-${module.id}-status`}
                className="mt-auto text-xs font-medium text-waia-accent-warm-muted/90"
              >
                Coming soon
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
