import { isSupremeAdminEmail, useAccount } from "@/lib/account";

type VerifiedBadgeProps = {
  email?: string | null | undefined;
  verified?: boolean | undefined;
  className?: string;
};

const STAR_POINTS = Array.from({ length: 40 }, (_, index) => {
  const angle = -Math.PI / 2 + (index * Math.PI) / 20;
  const radius = index % 2 === 0 ? 11.2 : 9.1;
  return `${(12 + Math.cos(angle) * radius).toFixed(2)},${(12 + Math.sin(angle) * radius).toFixed(2)}`;
}).join(" ");

export function VerifiedBadge({ email, verified = false, className = "size-5" }: VerifiedBadgeProps) {
  const account = useAccount();
  const isSupreme = isSupremeAdminEmail(email) || (account.isAdmin && !email);
  if (!isSupreme && !verified) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0 drop-shadow-[0_0_6px_rgba(29,155,240,0.85)]`}
      role="img"
      aria-label={isSupreme ? "Admin Supremo verificado" : "Perfil verificado"}
    >
      <polygon points={STAR_POINTS} fill="#1D9BF0" />
      <path
        d="M7.3 12.4l3.1 3.1 6.3-6.6"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
