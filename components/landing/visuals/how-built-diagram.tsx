import { DiagramShell } from "@/components/landing/visuals/diagram-shell";

const GOLD = "#c9a96e";
const PLAT = "#b8c4d6";
const MUTED = "rgba(210,205,195,0.72)";
const LINE = "rgba(218,200,160,0.38)";

const STAGES: { y: number; label: string; note?: string; emphasis?: "gold" | "plat" }[] = [
  { y: 48, label: "Question" },
  { y: 82, label: "LEGCO.LIVE / Research", note: "public research entry", emphasis: "gold" },
  { y: 116, label: "Understanding" },
  { y: 150, label: "Human Decision", note: "authority retained", emphasis: "gold" },
  { y: 184, label: "Linear / Canonical plan", note: "task & plan" },
  { y: 218, label: "Code / GitHub", note: "inspectable record", emphasis: "plat" },
  { y: 252, label: "Validation" },
  { y: 286, label: "Human Integration", note: "merge authority", emphasis: "gold" },
  { y: 320, label: "Knowledge" },
];

/**
 * V-BUILT — research → governed engineering → knowledge pipeline.
 * WAIA DEV OS spans Decision → Integration; GitHub is inspectable record.
 */
export function HowBuiltDiagram() {
  return (
    <DiagramShell
      testId="landing-how-built-media"
      label="How WAIA is built pipeline diagram"
      description="Flow from question through LEGCO research, human decision, Linear plan, GitHub code, validation, human integration, to knowledge. WAIA DEV OS governs the engineering span. External contributors do not automatically receive merge authority."
    >
      <text
        x="160"
        y="26"
        textAnchor="middle"
        fill={GOLD}
        fontSize="10"
        fontFamily="system-ui,sans-serif"
        letterSpacing="0.05em"
      >
        INQUIRY → IMPLEMENTATION
      </text>

      {/* DEV OS bracket spanning Decision through Human Integration */}
      <rect
        x="18"
        y="138"
        width="12"
        height="168"
        rx="3"
        fill="rgba(170,190,220,0.12)"
        stroke="rgba(170,190,220,0.35)"
      />
      <text
        x="14"
        y="222"
        fill={PLAT}
        fontSize="7"
        fontFamily="system-ui,sans-serif"
        transform="rotate(-90 14 222)"
        textAnchor="middle"
      >
        WAIA DEV OS
      </text>

      {STAGES.map((stage, i) => {
        const stroke = stage.emphasis === "gold" ? GOLD : stage.emphasis === "plat" ? PLAT : LINE;
        return (
          <g key={stage.label}>
            {i > 0 ? (
              <line
                x1="160"
                y1={STAGES[i - 1]!.y + 14}
                x2="160"
                y2={stage.y - 12}
                stroke={LINE}
                strokeWidth="1"
              />
            ) : null}
            <rect
              x="48"
              y={stage.y - 12}
              width="224"
              height={stage.note ? 28 : 24}
              rx="6"
              fill="rgba(0,0,0,0.3)"
              stroke={stroke}
              strokeWidth="1.1"
            />
            <text
              x="160"
              y={stage.note ? stage.y + 1 : stage.y + 4}
              textAnchor="middle"
              fill={MUTED}
              fontSize="10"
              fontFamily="system-ui,sans-serif"
            >
              {stage.label}
            </text>
            {stage.note ? (
              <text
                x="160"
                y={stage.y + 12}
                textAnchor="middle"
                fill="rgba(210,205,195,0.45)"
                fontSize="7"
                fontFamily="system-ui,sans-serif"
              >
                {stage.note}
              </text>
            ) : null}
          </g>
        );
      })}

      <text
        x="160"
        y="368"
        textAnchor="middle"
        fill="rgba(210,205,195,0.5)"
        fontSize="8"
        fontFamily="system-ui,sans-serif"
      >
        Open inspection ≠ automatic merge authority
      </text>
    </DiagramShell>
  );
}
