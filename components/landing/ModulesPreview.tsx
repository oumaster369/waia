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
    description: "Твой персональный цифровой двойник, который растёт через диалог и дневник.",
    role: "Personal intelligence layer ecosystem WAIA. Доступен сразу после входа.",
  },
  {
    id: "3p-business",
    name: "3P (Business)",
    description: "Бизнес-слой WAIA по логике Provision, Promotion, Production.",
    role: "Business layer для компаний и команд. Подключается позднее.",
  },
  {
    id: "ai-marketplace",
    name: "AI-Marketplace",
    description: "Экономический и маркетплейс-слой WAIA-экосистемы.",
    role: "Marketplace layer для обмена ценностью между AI-Twins и бизнесами. Подключается позднее.",
  },
];

export function ModulesPreview() {
  return (
    <section
      data-testid="landing-modules"
      aria-label="WAIA modules preview"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-10 sm:py-14"
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
        {MODULES.map((module) => (
          <article
            key={module.id}
            data-testid={`landing-module-${module.id}`}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xs"
          >
            <h2 className="text-lg font-semibold tracking-tight">{module.name}</h2>
            <p
              data-testid={`landing-module-${module.id}-description`}
              className="text-sm text-foreground"
            >
              {module.description}
            </p>
            <p
              data-testid={`landing-module-${module.id}-role`}
              className="text-sm text-muted-foreground"
            >
              {module.role}
            </p>
            {module.id !== "ai-twin" && (
              <p
                data-testid={`landing-module-${module.id}-status`}
                className="mt-auto text-xs uppercase tracking-wide text-muted-foreground"
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
