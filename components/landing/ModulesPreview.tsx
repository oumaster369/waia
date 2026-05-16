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
            className="flex flex-col gap-3 rounded-2xl border border-[rgba(218,200,160,0.28)] bg-[rgba(3,8,19,0.52)] p-6 font-sans shadow-[inset_0_1px_0_rgba(255,252,245,0.06)] backdrop-blur-[12px]"
          >
            <h2 className="text-lg font-semibold tracking-tight text-[#ebe4d4]">
              {module.name}
            </h2>
            <p
              data-testid={`landing-module-${module.id}-description`}
              className="text-sm font-normal leading-relaxed text-[rgba(210,205,195,0.92)]"
            >
              {module.description}
            </p>
            <p
              data-testid={`landing-module-${module.id}-role`}
              className="text-sm font-normal leading-relaxed text-[rgba(180,175,168,0.88)]"
            >
              {module.role}
            </p>
            {module.id !== "ai-twin" && (
              <p
                data-testid={`landing-module-${module.id}-status`}
                className="mt-auto text-xs font-semibold tracking-wide text-[#c9a96e]"
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
