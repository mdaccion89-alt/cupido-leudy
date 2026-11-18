import { cn } from "@/lib/utils";

function WavingArm({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="rotate"
        values={`0 ${x} ${y}; -28 ${x} ${y}; 8 ${x} ${y}; 0 ${x} ${y}`}
        dur="1.15s"
        repeatCount="indefinite"
      />
      <path
        d={`M ${x} ${y} L ${x + 15} ${y - 19}`}
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx={x + 15} cy={y - 19} r="6.5" fill={color} />
    </g>
  );
}

function Eyes({ left = 43, right = 77, y = 55 }: { left?: number; right?: number; y?: number }) {
  return (
    <g fill="#20243a">
      <ellipse cx={left} cy={y} rx="5" ry="6.5" />
      <ellipse cx={right} cy={y} rx="5" ry="6.5" />
      <circle cx={left + 1.5} cy={y - 2} r="1.6" fill="#ffffff" />
      <circle cx={right + 1.5} cy={y - 2} r="1.6" fill="#ffffff" />
    </g>
  );
}

function Smile({ d = "M 44 72 Q 60 86 76 72" }: { d?: string }) {
  return <path d={d} stroke="#20243a" strokeWidth="4" strokeLinecap="round" fill="none" />;
}

const MASCOTS = [
  {
    name: "Lumi",
    render: () => (
      <>
        <g stroke="#ffc857" strokeWidth="6" strokeLinecap="round">
          <path d="M60 14 V26" />
          <path d="M60 94 V106" />
          <path d="M14 60 H26" />
          <path d="M94 60 H106" />
          <path d="M27 27 L36 36" />
          <path d="M84 84 L93 93" />
          <path d="M93 27 L84 36" />
          <path d="M36 84 L27 93" />
        </g>
        <circle cx="60" cy="60" r="34" fill="#ffd166" />
        <circle cx="49" cy="52" r="6" fill="#fff3c4" opacity="0.8" />
        <Eyes />
        <Smile />
        <WavingArm x={88} y={70} color="#ffb703" />
      </>
    ),
  },
  {
    name: "Pixel",
    render: () => (
      <>
        <path d="M60 18 V30" stroke="#7dd3fc" strokeWidth="5" strokeLinecap="round" />
        <circle cx="60" cy="16" r="6" fill="#38bdf8" />
        <rect x="28" y="30" width="64" height="62" rx="18" fill="#93c5fd" />
        <rect x="36" y="38" width="48" height="42" rx="12" fill="#dbeafe" />
        <Eyes left={49} right={71} y={55} />
        <Smile d="M 49 72 Q 60 80 71 72" />
        <rect x="42" y="92" width="36" height="10" rx="5" fill="#60a5fa" />
        <WavingArm x={92} y={68} color="#60a5fa" />
      </>
    ),
  },
  {
    name: "Nube",
    render: () => (
      <>
        <path
          d="M32 80 Q18 80 20 65 Q22 52 36 54 Q40 35 59 38 Q72 27 84 42 Q102 42 100 62 Q104 80 86 80 Z"
          fill="#e0f2fe"
        />
        <circle cx="43" cy="48" r="13" fill="#f0f9ff" />
        <circle cx="62" cy="42" r="17" fill="#f0f9ff" />
        <Eyes left={48} right={72} y={60} />
        <Smile d="M 50 72 Q 60 81 70 72" />
        <path d="M46 90 V100" stroke="#7dd3fc" strokeWidth="5" strokeLinecap="round" />
        <path d="M74 90 V100" stroke="#7dd3fc" strokeWidth="5" strokeLinecap="round" />
        <WavingArm x={94} y={70} color="#7dd3fc" />
      </>
    ),
  },
  {
    name: "Zorro",
    render: () => (
      <>
        <path d="M30 42 L26 16 L49 32 Z" fill="#fb923c" />
        <path d="M90 42 L94 16 L71 32 Z" fill="#fb923c" />
        <path d="M60 28 Q96 28 96 64 Q96 96 60 100 Q24 96 24 64 Q24 28 60 28 Z" fill="#fdba74" />
        <path d="M60 58 Q70 70 60 84 Q50 70 60 58 Z" fill="#fff7ed" />
        <Eyes left={45} right={75} y={56} />
        <Smile d="M 48 84 Q 60 93 72 84" />
        <circle cx="34" cy="70" r="4" fill="#fb7185" opacity="0.6" />
        <circle cx="86" cy="70" r="4" fill="#fb7185" opacity="0.6" />
        <WavingArm x={93} y={72} color="#f97316" />
      </>
    ),
  },
];

export function VideoMascot({
  seed,
  className,
  compact = false,
}: {
  seed?: number;
  className?: string;
  compact?: boolean;
}) {
  const index =
    seed === undefined
      ? Math.floor(Math.random() * MASCOTS.length)
      : Math.abs(Math.trunc(seed)) % MASCOTS.length;
  const mascot = MASCOTS[index] ?? MASCOTS[0]!;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-surface/70 px-3 py-2",
        compact ? "w-24" : "w-32",
        className,
      )}
    >
      <svg
        viewBox="0 0 120 120"
        className={compact ? "size-16" : "size-24"}
        role="img"
        aria-label={`Mascota ${mascot.name}`}
      >
        {mascot.render()}
      </svg>
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {mascot.name}
      </span>
    </div>
  );
}
