import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

export type AssistantHelpEntry = {
  tool: (typeof ADMIN_TOOLS)[number];
  title: string;
  description: string;
  example: string;
};

/** Tools whose read function is the same one the console route calls. */
export const ASSISTANT_HELP: readonly AssistantHelpEntry[] = [
  {
    tool: "get_overview",
    title: "Summary",
    description: "Equity, coverage and reasons why a figure is incomplete.",
    example: "What is on the overview now?",
  },
  {
    tool: "list_accounts",
    title: "Accounts",
    description: "Connected accounts. Key secrets are not read.",
    example: "Which accounts are connected?",
  },
  {
    tool: "list_clients",
    title: "Clients",
    description: "Organizations with module access and their status.",
    example: "Which clients are active?",
  },
  {
    tool: "list_invoices",
    title: "Invoices",
    description: "Invoice statuses. The console does not issue invoices itself.",
    example: "Which invoices are unpaid?",
  },
  {
    tool: "list_orders",
    title: "Orders",
    description: "Working orders.",
    example: "Which orders are still working?",
  },
  {
    tool: "strategy_performance",
    title: "Strategies",
    description: "Catalog and statistics. Percentage returns are not calculated.",
    example: "Which strategies are available?",
  },
  {
    tool: "list_research_runs",
    title: "Research",
    description: "Run state. The sealed sample is inaccessible.",
    example: "How did the latest run finish?",
  },
  {
    tool: "list_incidents",
    title: "Incidents",
    description: "Console errors without stack text.",
    example: "Which errors are open?",
  },
  {
    tool: "system_status",
    title: "System",
    description: "Unconfirmed release, jobs and missed minutes.",
    example: "What is the state of the release and jobs?",
  },
  {
    tool: "list_jobs",
    title: "Jobs",
    description: "Job catalog and latest runs.",
    example: "Which jobs missed a minute?",
  },
  {
    tool: "release_info",
    title: "Release",
    description: "Only the SHA from the variable is known. Deployment match is unconfirmed.",
    example: "Which release is currently specified?",
  },
  {
    tool: "search",
    title: "Search",
    description: "Search clients, accounts, orders and invoices.",
    example: "Find an account by name.",
  },
];

export function assistantHelpEntries(): readonly AssistantHelpEntry[] {
  return ASSISTANT_HELP.filter((entry) => ADMIN_TOOLS.includes(entry.tool));
}
