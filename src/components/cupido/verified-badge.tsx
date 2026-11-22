import { toast } from "sonner";
import { isSupremeAdminEmail } from "@/lib/account";

type VerifiedBadgeProps = {
  email?: string | null | undefined;
  verified?: boolean | undefined;
  official?: boolean | undefined;
  granLiga?: boolean | undefined;
  className?: string;
};

const STAR_POINTS = Array.from({ length: 40 }, (_, index) => {
  const angle = -Math.PI / 2 + (index * Math.PI) / 20;
  const radius = index % 2 === 0 ? 11.2 : 9.1;
  return `${(12 + Math.cos(angle) * radius).toFixed(2)},${(12 + Math.sin(angle) * radius).toFixed(2)}`;
}).join(" ");

export function VerifiedBadge({ email, verified = false, official = false, granLiga = false, className = "size-5" }: VerifiedBadgeProps) {
  if (granLiga) {
    return (
      <button
        type="button"
        className={`${className} inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-amber-200 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        aria-label="Gran Liga"
        title="Gran Liga"
        onClick={(event) => { event.stopPropagation(); toast.message("Gran Liga"); }}
      >
        <span className="relative inline-flex size-full items-center justify-center" aria-hidden="true">
          <span className="absolute -top-1 -right-1 text-[0.55em] animate-bounce">🔥</span>
          <span className="text-[0.9em]">💎</span>
          <span className="absolute -bottom-1 -left-1 text-[0.5em]">⭐</span>
        </span>
      </button>
    );
  }
  const isSupreme = isSupremeAdminEmail(email) || official;
  if (!isSupreme && !verified) return null;
  const label = isSupreme ? "Cuenta Oficial Verificada" : "Perfil verificado";

  return (
    <button
      type="button"
      className={`${className} inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        toast.message(label);
      }}
    >
      <svg viewBox="0 0 24 24" className="size-full drop-shadow-[0_0_6px_rgba(29,155,240,0.85)]" aria-hidden="true">
        <polygon points={STAR_POINTS} fill="#1D9BF0" />
        <path d="M7.3 12.4l3.1 3.1 6.3-6.6" fill="none" stroke="#ffffff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function GranLigaStar({ active = false }: { active?: boolean }) {
  if (!active) return null;
  return <span aria-label="Estrella Gran Liga" className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 text-sm leading-none text-amber-200 drop-shadow-[0_0_8px_rgba(251,191,36,0.95)] animate-pulse">⭐</span>;
}
