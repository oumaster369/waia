/**
 * Subliminal atmospheric motes — partner landing only.
 * Fixed layout; motion lives in globals.css with prefers-reduced-motion guard.
 */
const DUST_MOTES: ReadonlyArray<{ left: number; top: number; duration: number; delay: number }> = [
  { left: 7, top: 11, duration: 148, delay: 0 },
  { left: 16, top: 38, duration: 176, delay: -40 },
  { left: 24, top: 72, duration: 162, delay: -12 },
  { left: 38, top: 19, duration: 190, delay: -88 },
  { left: 49, top: 55, duration: 155, delay: -55 },
  { left: 58, top: 88, duration: 172, delay: -20 },
  { left: 71, top: 28, duration: 165, delay: -110 },
  { left: 82, top: 63, duration: 182, delay: -66 },
  { left: 91, top: 14, duration: 158, delay: -30 },
  { left: 12, top: 91, duration: 168, delay: -95 },
  { left: 44, top: 82, duration: 152, delay: -48 },
  { left: 63, top: 41, duration: 178, delay: -72 },
  { left: 77, top: 7, duration: 160, delay: -15 },
  { left: 5, top: 52, duration: 170, delay: -102 },
];

export function CeremonialAirDust() {
  return (
    <div aria-hidden className="waia-ceremony-air pointer-events-none absolute inset-0 -z-[8] overflow-hidden">
      {DUST_MOTES.map((m, i) => (
        <span
          key={i}
          className="waia-ceremony-dust-mote absolute rounded-full bg-[color-mix(in_oklch,var(--waia-color-fg-primary)_9%,transparent)] blur-[0.5px]"
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            width: "max(1px,0.09rem)",
            height: "max(1px,0.09rem)",
            animationDuration: `${m.duration}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
