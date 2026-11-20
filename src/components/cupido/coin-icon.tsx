export function CoinIcon({ className = "size-4" }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} aria-hidden="true">
      <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_210deg,#b45309,#fde68a,#f59e0b,#fff7cd,#d97706,#b45309)] shadow-[0_0_12px_rgba(251,191,36,0.65)] animate-coin-spin" />
      <span className="absolute inset-[14%] rounded-full border border-amber-100/70 bg-gradient-to-br from-yellow-200 via-amber-400 to-amber-600" />
      <span className="relative text-[0.52em] font-black leading-none text-amber-950">B</span>
      <span className="absolute -right-1 -top-1 text-[0.65em] leading-none text-amber-100 animate-coin-sparkle">✦</span>
    </span>
  );
}
