import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import styles from "@/components/landing/visuals/breath-time-radar.module.css";

const HOUR_MARKS = Array.from({ length: 12 }, (_, index) => {
  const angle = (index * Math.PI) / 6 - Math.PI / 2;
  const isQuarter = index % 3 === 0;
  const innerRadius = isQuarter ? 78 : 82;
  const outerRadius = 87;

  return {
    index,
    x1: 100 + Math.cos(angle) * innerRadius,
    y1: 100 + Math.sin(angle) * innerRadius,
    x2: 100 + Math.cos(angle) * outerRadius,
    y2: 100 + Math.sin(angle) * outerRadius,
    isQuarter,
  };
});

const CONTACTS = [
  { x: 67, y: 56, radius: 2.2, delay: "-0.9s" },
  { x: 43, y: 92, radius: 1.7, delay: "-2.2s" },
  { x: 62, y: 139, radius: 2.5, delay: "-3.5s" },
  { x: 112, y: 151, radius: 1.8, delay: "-4.8s" },
  { x: 151, y: 122, radius: 2.4, delay: "-6.1s" },
  { x: 139, y: 69, radius: 1.9, delay: "-7.3s" },
  { x: 83, y: 105, radius: 1.5, delay: "-1.8s" },
] as const;

function contactStyle(delay: string): CSSProperties {
  return { "--contact-delay": delay } as CSSProperties;
}

export function BreathTimeRadar() {
  return (
    <div
      aria-hidden="true"
      data-testid="landing-breath-time-radar"
      className={cn(
        styles.frame,
        "border-waia-divider relative flex min-h-48 items-center justify-center overflow-hidden rounded-2xl border sm:min-h-44",
      )}
    >
      <svg className={styles.radar} viewBox="0 0 200 200" role="presentation" focusable="false">
        <circle className={styles.outerRing} cx="100" cy="100" r="90" />
        <circle className={styles.rangeRing} cx="100" cy="100" r="61" />
        <circle className={styles.rangeRing} cx="100" cy="100" r="32" />
        <line className={styles.axis} x1="17" y1="100" x2="183" y2="100" />
        <line className={styles.axis} x1="100" y1="17" x2="100" y2="183" />

        {HOUR_MARKS.map((mark) => (
          <line
            key={mark.index}
            className={cn(styles.hourMark, mark.isQuarter && styles.quarterMark)}
            x1={mark.x1}
            y1={mark.y1}
            x2={mark.x2}
            y2={mark.y2}
          />
        ))}

        <text className={styles.hourNumber} x="100" y="20" textAnchor="middle">
          12
        </text>
        <text className={styles.hourNumber} x="178" y="103" textAnchor="middle">
          3
        </text>
        <text className={styles.hourNumber} x="100" y="184" textAnchor="middle">
          6
        </text>
        <text className={styles.hourNumber} x="22" y="103" textAnchor="middle">
          9
        </text>

        {CONTACTS.map((contact, index) => (
          <circle
            key={`${contact.x}-${contact.y}`}
            data-testid={`landing-breath-radar-contact-${index + 1}`}
            className={styles.contact}
            cx={contact.x}
            cy={contact.y}
            r={contact.radius}
            style={contactStyle(contact.delay)}
          />
        ))}

        <g
          data-testid="landing-breath-radar-sweep"
          data-rotation="counterclockwise"
          className={styles.sweep}
        >
          <path className={styles.beam} d="M100 100 L83 25 A77 77 0 0 1 100 23 Z" />
          <line className={styles.hand} x1="100" y1="108" x2="100" y2="23" />
          <path className={styles.arrowHead} d="M100 17 L95.5 27 H104.5 Z" />
        </g>

        <circle className={styles.centerHalo} cx="100" cy="100" r="7" />
        <circle className={styles.centerPoint} cx="100" cy="100" r="2.3" />
      </svg>
    </div>
  );
}
