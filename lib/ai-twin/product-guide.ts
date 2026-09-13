/** Curated current-workspace help, not generated advice or capability authority.
 * DEE-994; review alongside the named UI contracts when those features change.
 * Never sent as a Human observation or used to compute Formation progress. */
export const TWIN_PRODUCT_GUIDE = Object.freeze({
  version: "waia-workspace-guide/2026-09-12/v1",
  topics: [
    {
      id: "conversation",
      label: "Your first conversation",
      title: "Begin with one thought",
      steps: [
        "If this is your first visit, choose Start creating your AI-Twin. Reading this guide does not start the conversation.",
        "Write in the language you think in. You can ask a question, describe a situation, or say what you would like to discuss.",
        "Choose Send when you are ready. There is no need to answer everything or share more than you want to.",
      ],
      note: "You choose the topic and the pace. There is no required questionnaire.",
    },
    {
      id: "retry",
      label: "Messages and retries",
      title: "When a message does not send",
      steps: [
        "While Sending is shown, wait for the current attempt to finish.",
        "If your message is marked Not sent, read the error above the conversation. Choose Retry beside that message to repeat the same request.",
        "If a response is unavailable, follow the message shown. A saved message and an available AI reply are different things.",
      ],
      note: "This guide does not resend messages. Return to the conversation to choose what to do.",
    },
    {
      id: "progress",
      label: "Progress and privacy",
      title: "Keep your own judgement",
      steps: [
        "The indicators are about the Twin's formation, not a measure of your worth or proof that it fully understands you.",
        "Opening help, reading steps and closing this guide do not increase progress or give WAIA permission to act.",
        "Share only what you choose to add to the conversation. Do not include passwords, payment credentials or other people's private information.",
      ],
      note: "This guide does not change permissions or delete stored data. The new model-review and data-control experience is still being developed.",
    },
    {
      id: "features",
      label: "Other features",
      title: "What the workspace offers",
      steps: [
        "Use the tabs shown in your workspace to see which sections are available. This guide cannot check or change your account permissions.",
        "Diary supports saving and viewing recent entries when available. Predictions and Personality Insights still show planned-feature information. The Society preview is not a live social network.",
        "Avatar capture, connected services and real-world tasks are not available from this guide. A visible tab or a progress value does not authorize any of them.",
      ],
      note: "Close this guide before choosing another section. An unsent conversation draft may not survive switching tabs or leaving the page.",
    },
    {
      id: "subscription",
      label: "Costs and subscription",
      title: "Understand before you agree",
      steps: [
        "Creating and training your AI Twin is currently free. The terms remain visible below the message box.",
        "Future network subscription requires the applicable price to be shown and your explicit confirmation before billing begins.",
        "Reading help, reaching a progress value or viewing a preview does not start a subscription or make a payment.",
      ],
      note: "This guide has no payment or subscription controls.",
    },
  ],
} as const);
