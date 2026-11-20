import { BadgeCheck } from "lucide-react";
import { isSupremeAdminEmail, useAccount } from "@/lib/account";

type VerifiedBadgeProps = {
  email?: string | null | undefined;
  verified?: boolean | undefined;
  className?: string;
};

export function VerifiedBadge({ email, verified = false, className = "size-5" }: VerifiedBadgeProps) {
  const account = useAccount();
  const isSupreme = isSupremeAdminEmail(email) || (account.isAdmin && !email);
  if (!isSupreme && !verified) return null;
  return (
    <BadgeCheck
      className={`${className} shrink-0 fill-sky-400 text-white drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]`}
      aria-label={isSupreme ? "Admin Supremo verificado" : "Perfil verificado"}
    />
  );
}
