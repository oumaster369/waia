import { cn } from "@/lib/utils";

const GOLD = "#c9a96e";
const MUTED = "rgba(210,205,195,0.72)";
const DIM = "rgba(210,205,195,0.45)";
const LINE = "rgba(218,200,160,0.32)";

/**
 * V-MARKETPLACE — compact inline inversion mark (not a large plate).
 * Directional arrows are self-contained via SVG `<defs>` markers.
 */
export function MarketplaceDiagram({ className }: { className?: string }) {
  return (
    <figure
      data-testid="landing-ai-marketplace-diagram"
      data-media-slot="diagram-inline"
      className={cn(
        "w-full overflow-hidden rounded-xl border border-[rgba(218,200,160,0.16)]",
        "bg-[rgba(4,10,22,0.85)] px-3 py-4 sm:px-4",
        className,
      )}
    >
      <svg
        viewBox="0 0 640 148"
        className="h-auto max-h-[9.5rem] w-full"
        role="img"
        aria-label="Marketplace inversion diagram. Traditional path: Offer to advertising to click to funnel. WAIA path: Need to context understanding to relevant possibilities to comparison to conscious choice."
      >
        <defs>
          <marker
            id="mkt-arrow-dim"
            data-testid="landing-marketplace-marker-dim"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(218,200,160,0.45)" />
          </marker>
          <marker
            id="mkt-arrow-gold"
            data-testid="landing-marketplace-marker-gold"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={GOLD} />
          </marker>
        </defs>

        {/* Traditional */}
        <text
          x="8"
          y="18"
          fill={DIM}
          fontSize="10"
          fontFamily="system-ui,sans-serif"
          letterSpacing="0.06em"
        >
          TRADITIONAL
        </text>
        {[
          { x: 8, label: "Offer" },
          { x: 118, label: "Attention" },
          { x: 248, label: "Click" },
          { x: 358, label: "Funnel" },
        ].map((step, i) => (
          <g key={step.label}>
            {i > 0 ? (
              <line
                x1={step.x - 22}
                y1="42"
                x2={step.x}
                y2="42"
                stroke={LINE}
                strokeWidth="1"
                markerEnd="url(#mkt-arrow-dim)"
              />
            ) : null}
            <rect
              x={step.x}
              y="28"
              width={i === 1 ? 100 : 88}
              height="28"
              rx="6"
              fill="rgba(255,252,245,0.03)"
              stroke="rgba(218,200,160,0.2)"
            />
            <text
              x={step.x + (i === 1 ? 50 : 44)}
              y="46"
              textAnchor="middle"
              fill={DIM}
              fontSize="11"
              fontFamily="system-ui,sans-serif"
            >
              {step.label}
            </text>
          </g>
        ))}

        {/* Divider */}
        <line x1="8" y1="78" x2="632" y2="78" stroke="rgba(218,200,160,0.14)" strokeWidth="1" />

        {/* WAIA */}
        <text
          x="8"
          y="98"
          fill={GOLD}
          fontSize="10"
          fontFamily="system-ui,sans-serif"
          letterSpacing="0.06em"
        >
          WAIA
        </text>
        {[
          { x: 8, w: 72, label: "Need" },
          { x: 100, w: 108, label: "Context" },
          { x: 228, w: 118, label: "Possibilities" },
          { x: 366, w: 100, label: "Compare" },
          { x: 486, w: 120, label: "Choice" },
        ].map((step, i) => (
          <g key={step.label}>
            {i > 0 ? (
              <line
                x1={step.x - 16}
                y1="122"
                x2={step.x}
                y2="122"
                stroke={GOLD}
                strokeWidth="1.15"
                markerEnd="url(#mkt-arrow-gold)"
              />
            ) : null}
            <rect
              x={step.x}
              y="108"
              width={step.w}
              height="28"
              rx="6"
              fill="rgba(201,169,110,0.1)"
              stroke="rgba(218,200,160,0.4)"
            />
            <text
              x={step.x + step.w / 2}
              y="126"
              textAnchor="middle"
              fill={MUTED}
              fontSize="11"
              fontFamily="system-ui,sans-serif"
            >
              {step.label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
