import { DiagramShell } from "@/components/landing/visuals/diagram-shell";

const GOLD = "#c9a96e";
const PLAT = "#b8c4d6";
const MUTED = "rgba(210,205,195,0.72)";
const LINE = "rgba(218,200,160,0.35)";

/**
 * V-BREATH — dual transparency: resources ↔ work.
 * No live numbers; works in pending DEE-606 state.
 */
export function BreathDiagram() {
  return (
    <DiagramShell
      testId="landing-breath-media"
      label="Breath of WAIA transparency diagram"
      description="Two inseparable sides: resource transparency and work transparency, joined by traceability. GitHub represents inspectable engineering truth. No published amounts shown."
      className="max-h-[28rem] lg:max-h-none"
    >
      <text
        x="160"
        y="28"
        textAnchor="middle"
        fill={GOLD}
        fontSize="11"
        fontFamily="system-ui,sans-serif"
        letterSpacing="0.08em"
      >
        TRANSPARENCY
      </text>

      {/* Resource column */}
      <text
        x="78"
        y="58"
        textAnchor="middle"
        fill={GOLD}
        fontSize="10"
        fontFamily="system-ui,sans-serif"
        fontWeight="600"
      >
        RESOURCES
      </text>
      {[
        { y: 88, full: "Received" },
        { y: 128, full: "Allocated" },
        { y: 168, full: "Spent" },
        { y: 208, full: "Remaining" },
        { y: 248, full: "Needed next" },
      ].map((step, i) => (
        <g key={step.full}>
          {i > 0 ? (
            <line x1="78" y1={step.y - 28} x2="78" y2={step.y - 14} stroke={LINE} strokeWidth="1" />
          ) : null}
          <rect
            x="28"
            y={step.y - 12}
            width="100"
            height="24"
            rx="6"
            fill="rgba(0,0,0,0.28)"
            stroke={LINE}
          />
          <text
            x="78"
            y={step.y + 4}
            textAnchor="middle"
            fill={MUTED}
            fontSize="10"
            fontFamily="system-ui,sans-serif"
          >
            {step.full}
          </text>
        </g>
      ))}

      {/* Work column */}
      <text
        x="242"
        y="58"
        textAnchor="middle"
        fill={PLAT}
        fontSize="10"
        fontFamily="system-ui,sans-serif"
        fontWeight="600"
      >
        WORK
      </text>
      {[
        { y: 88, full: "Research" },
        { y: 128, full: "Plans" },
        { y: 168, full: "Code" },
        { y: 208, full: "Validation" },
        { y: 248, full: "Delivered" },
      ].map((step, i) => (
        <g key={step.full}>
          {i > 0 ? (
            <line
              x1="242"
              y1={step.y - 28}
              x2="242"
              y2={step.y - 14}
              stroke="rgba(170,190,220,0.35)"
              strokeWidth="1"
            />
          ) : null}
          <rect
            x="192"
            y={step.y - 12}
            width="100"
            height="24"
            rx="6"
            fill="rgba(0,0,0,0.28)"
            stroke="rgba(170,190,220,0.32)"
          />
          <text
            x="242"
            y={step.y + 4}
            textAnchor="middle"
            fill={MUTED}
            fontSize="10"
            fontFamily="system-ui,sans-serif"
          >
            {step.full}
          </text>
        </g>
      ))}

      {/* Traceability bridge */}
      <line
        x1="132"
        y1="168"
        x2="188"
        y2="168"
        stroke={GOLD}
        strokeWidth="1.25"
        strokeDasharray="3 3"
      />
      <text
        x="160"
        y="158"
        textAnchor="middle"
        fill={GOLD}
        fontSize="8"
        fontFamily="system-ui,sans-serif"
        letterSpacing="0.06em"
      >
        TRACEABILITY
      </text>

      {/* Flow note */}
      <text
        x="160"
        y="292"
        textAnchor="middle"
        fill="rgba(210,205,195,0.55)"
        fontSize="9"
        fontFamily="system-ui,sans-serif"
      >
        resources → allocation → work
      </text>
      <text
        x="160"
        y="308"
        textAnchor="middle"
        fill="rgba(210,205,195,0.55)"
        fontSize="9"
        fontFamily="system-ui,sans-serif"
      >
        → inspectable outputs
      </text>

      {/* GitHub as inspectable truth */}
      <rect
        x="70"
        y="330"
        width="180"
        height="40"
        rx="8"
        fill="rgba(201,169,110,0.08)"
        stroke="rgba(218,200,160,0.4)"
      />
      <text
        x="160"
        y="348"
        textAnchor="middle"
        fill={GOLD}
        fontSize="10"
        fontFamily="system-ui,sans-serif"
        fontWeight="600"
      >
        GitHub
      </text>
      <text
        x="160"
        y="362"
        textAnchor="middle"
        fill={MUTED}
        fontSize="8"
        fontFamily="system-ui,sans-serif"
      >
        inspectable engineering truth
      </text>
    </DiagramShell>
  );
}
