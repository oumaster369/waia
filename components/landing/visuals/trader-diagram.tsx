import { DiagramShell } from "@/components/landing/visuals/diagram-shell";
import styles from "@/components/landing/visuals/trader-diagram.module.css";

const GOLD = "#c9a96e";
const PLAT = "#b8c4d6";
const MUTED = "rgba(210,205,195,0.72)";
const LINE = "rgba(218,200,160,0.4)";
const ABSTAIN = "#9db0c8";

function Node({
  x,
  y,
  w,
  label,
  className,
  stroke = LINE,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  className?: string;
  stroke?: string;
}) {
  return (
    <g className={className}>
      <rect
        x={x}
        y={y}
        width={w}
        height={26}
        rx="6"
        fill="rgba(0,0,0,0.32)"
        stroke={stroke}
        strokeWidth="1.15"
      />
      <text
        x={x + w / 2}
        y={y + 17}
        textAnchor="middle"
        fill={MUTED}
        fontSize="9"
        fontFamily="system-ui,sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * V-TRADER — epistemic pipeline with equal-weight NO TRADE branch.
 * No charts, profit arrows, or crypto imagery.
 */
export function TraderDiagram() {
  return (
    <div className={styles.reveal}>
      <DiagramShell
        testId="landing-ai-trader-media"
        label="AI-TRADER evidence and abstention diagram"
        description="Pipeline from observation through decision. Validated evidence may lead to risk-controlled capital action. Insufficient evidence leads to NO TRADE — a successful system outcome."
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
          KNOWLEDGE BEFORE CAPITAL
        </text>

        <Node className="node node-1" x={95} y={44} w={130} label="Observation" />
        <line
          className="pipeline"
          x1={160}
          y1={70}
          x2={160}
          y2={86}
          stroke={LINE}
          strokeWidth={1.2}
        />
        <Node className="node node-2" x={95} y={86} w={130} label="Hypothesis" />
        <line
          className="pipeline"
          x1={160}
          y1={112}
          x2={160}
          y2={128}
          stroke={LINE}
          strokeWidth={1.2}
        />
        <Node className="node node-3" x={80} y={128} w={160} label="Test / Evidence" />
        <line
          className="pipeline"
          x1={160}
          y1={154}
          x2={160}
          y2={170}
          stroke={LINE}
          strokeWidth={1.2}
        />
        <Node className="node node-4" x={95} y={170} w={130} label="Forecast" />
        <line
          className="pipeline"
          x1={160}
          y1={196}
          x2={160}
          y2={212}
          stroke={LINE}
          strokeWidth={1.2}
        />
        <Node className="node node-5" x={95} y={212} w={130} label="Decision" stroke={GOLD} />

        <path
          className="branch"
          d="M 160 238 L 160 250 L 70 250 L 70 262"
          fill="none"
          stroke={LINE}
          strokeWidth={1.2}
        />
        <path
          className="branch"
          d="M 160 250 L 250 250 L 250 262"
          fill="none"
          stroke={LINE}
          strokeWidth={1.2}
        />

        <g className="node node-6">
          <rect
            x={18}
            y={262}
            width={104}
            height={52}
            rx={7}
            fill="rgba(201,169,110,0.08)"
            stroke={GOLD}
            strokeWidth={1.15}
          />
          <text
            x={70}
            y={282}
            textAnchor="middle"
            fill={GOLD}
            fontSize={8}
            fontFamily="system-ui,sans-serif"
          >
            Evidence sufficient
          </text>
          <text
            x={70}
            y={296}
            textAnchor="middle"
            fill={MUTED}
            fontSize={8}
            fontFamily="system-ui,sans-serif"
          >
            Risk → protected
          </text>
          <text
            x={70}
            y={308}
            textAnchor="middle"
            fill={MUTED}
            fontSize={8}
            fontFamily="system-ui,sans-serif"
          >
            capital action
          </text>
        </g>

        <g className="node node-7">
          <rect
            x={198}
            y={262}
            width={104}
            height={52}
            rx={7}
            fill="rgba(170,190,220,0.1)"
            stroke={ABSTAIN}
            strokeWidth={1.35}
          />
          <text
            x={250}
            y={282}
            textAnchor="middle"
            fill={PLAT}
            fontSize={8}
            fontFamily="system-ui,sans-serif"
          >
            Evidence insufficient
          </text>
          <text
            x={250}
            y={300}
            textAnchor="middle"
            fill={PLAT}
            fontSize={11}
            fontFamily="system-ui,sans-serif"
            fontWeight={700}
          >
            NO TRADE
          </text>
        </g>

        <text
          x={160}
          y={348}
          textAnchor="middle"
          fill={GOLD}
          fontSize={9}
          fontFamily="system-ui,sans-serif"
        >
          Abstention is a successful outcome
        </text>
        <text
          x={160}
          y={366}
          textAnchor="middle"
          fill="rgba(210,205,195,0.5)"
          fontSize={8}
          fontFamily="system-ui,sans-serif"
        >
          equal legitimacy with execution
        </text>
      </DiagramShell>
    </div>
  );
}
