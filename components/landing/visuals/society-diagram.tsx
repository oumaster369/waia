import { DiagramShell } from "@/components/landing/visuals/diagram-shell";

const GOLD = "#c9a96e";
const PLAT = "#b8c4d6";
const MUTED = "rgba(210,205,195,0.7)";
const LINE = "rgba(218,200,160,0.38)";

/**
 * V-SOCIETY — sparse, consent-respecting coordination.
 * Independent human+twin pairs; no central controller; not a social graph.
 */
export function SocietyDiagram() {
  return (
    <DiagramShell
      testId="landing-society-media"
      label="Society sparse coordination diagram"
      description="Two independent people, each with their AI-TWIN, selectively coordinating. Autonomy preserved; no central controller."
    >
      <text
        x="160"
        y="30"
        textAnchor="middle"
        fill={GOLD}
        fontSize="10"
        fontFamily="system-ui,sans-serif"
        letterSpacing="0.06em"
      >
        SPARSE COORDINATION
      </text>

      {/* Pair A — left */}
      <g>
        <circle
          cx="78"
          cy="130"
          r="28"
          fill="rgba(201,169,110,0.12)"
          stroke={GOLD}
          strokeWidth="1.2"
        />
        <text
          x="78"
          y="134"
          textAnchor="middle"
          fill={MUTED}
          fontSize="9"
          fontFamily="system-ui,sans-serif"
        >
          Person
        </text>
        <circle
          cx="78"
          cy="210"
          r="24"
          fill="rgba(170,190,220,0.1)"
          stroke={PLAT}
          strokeWidth="1.1"
        />
        <text
          x="78"
          y="214"
          textAnchor="middle"
          fill={MUTED}
          fontSize="9"
          fontFamily="system-ui,sans-serif"
        >
          Twin
        </text>
        <line x1="78" y1="158" x2="78" y2="186" stroke={LINE} strokeWidth="1" />
        <circle cx="78" cy="172" r="2.5" fill="rgba(255,248,230,0.55)" />
      </g>

      {/* Pair B — right */}
      <g>
        <circle
          cx="242"
          cy="130"
          r="28"
          fill="rgba(201,169,110,0.12)"
          stroke={GOLD}
          strokeWidth="1.2"
        />
        <text
          x="242"
          y="134"
          textAnchor="middle"
          fill={MUTED}
          fontSize="9"
          fontFamily="system-ui,sans-serif"
        >
          Person
        </text>
        <circle
          cx="242"
          cy="210"
          r="24"
          fill="rgba(170,190,220,0.1)"
          stroke={PLAT}
          strokeWidth="1.1"
        />
        <text
          x="242"
          y="214"
          textAnchor="middle"
          fill={MUTED}
          fontSize="9"
          fontFamily="system-ui,sans-serif"
        >
          Twin
        </text>
        <line x1="242" y1="158" x2="242" y2="186" stroke={LINE} strokeWidth="1" />
        <circle cx="242" cy="172" r="2.5" fill="rgba(255,248,230,0.55)" />
      </g>

      {/* Single purposeful coordination link between twins (not everyone-to-everyone) */}
      <path
        d="M 102 200 C 140 175, 180 175, 218 200"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.25"
        strokeDasharray="4 5"
      />
      <text
        x="160"
        y="168"
        textAnchor="middle"
        fill={GOLD}
        fontSize="8"
        fontFamily="system-ui,sans-serif"
        letterSpacing="0.04em"
      >
        consent · meaning
      </text>

      {/* Autonomy note — no hub */}
      <text
        x="160"
        y="280"
        textAnchor="middle"
        fill="rgba(210,205,195,0.55)"
        fontSize="9"
        fontFamily="system-ui,sans-serif"
      >
        independent lives
      </text>
      <text
        x="160"
        y="298"
        textAnchor="middle"
        fill="rgba(210,205,195,0.55)"
        fontSize="9"
        fontFamily="system-ui,sans-serif"
      >
        selective alignment — no central controller
      </text>

      {/* Horizon line suggesting shared field without hierarchy */}
      <line x1="40" y1="340" x2="280" y2="340" stroke="rgba(218,200,160,0.2)" strokeWidth="1" />
      <text
        x="160"
        y="362"
        textAnchor="middle"
        fill={MUTED}
        fontSize="9"
        fontFamily="system-ui,sans-serif"
      >
        shared horizon, preserved autonomy
      </text>
    </DiagramShell>
  );
}
