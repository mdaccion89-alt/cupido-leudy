// Credit costs, packages and plans. Prices are charged in USD through PayPal.
export const CREDIT_COSTS = { song: 1, cover: 2, video: 5 } as const;
export type CreationKind = keyof typeof CREDIT_COSTS;

/** Free accounts are topped up to this many credits every 24 hours. */
export const DAILY_FREE_CREDITS = 5;
/** Files made on the free plan are deleted after this many days. */
export const FREE_FILE_RETENTION_DAYS = 7;

export const CREDIT_PACKAGES = [
  { id: "pack-10", credits: 10, price: "4.99", label: "Inicial" },
  { id: "pack-30", credits: 30, price: "12.99", label: "Creador", featured: true },
  { id: "pack-100", credits: 100, price: "34.99", label: "Estudio" },
] as const;
export type CreditPackage = (typeof CREDIT_PACKAGES)[number];

export type PlanId = "free" | "pro" | "premium";
export const PLANS = [
  { id: "pro", name: "PRO", price: "9.99", days: 30, bonusCredits: 50 },
  { id: "premium", name: "Premium", price: "19.99", days: 30, bonusCredits: 150 },
] as const;
export type Plan = (typeof PLANS)[number];

export function findPackage(id: unknown): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}
export function findPlan(id: unknown): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export type Product = { kind: "credits"; id: string; price: string; credits: number; label: string } | { kind: "plan"; id: string; price: string; plan: Plan; label: string };
export function findProduct(id: unknown): Product | undefined {
  const pack = findPackage(id);
  if (pack) return { kind: "credits", id: pack.id, price: pack.price, credits: pack.credits, label: `${pack.credits} créditos` };
  const plan = findPlan(id);
  if (plan) return { kind: "plan", id: plan.id, price: plan.price, plan, label: `Plan ${plan.name} (${plan.days} días)` };
  return undefined;
}

export function isPaidPlan(plan: string | null | undefined): boolean {
  return plan === "pro" || plan === "premium";
}

/** WAV, clean (no watermark) video and the user Pro studio mode are paid-plan perks. */
export function canUsePaidPerks(plan: string | null | undefined, isAdmin: boolean): boolean {
  return isAdmin || isPaidPlan(plan);
}

/** Blue verified badge: more than 1,000 real followers or an active Premium plan. */
export const VERIFIED_FOLLOWERS = 1000;
export function isVerifiedCreator(followers: number, isPremium: boolean): boolean {
  return followers > VERIFIED_FOLLOWERS || isPremium;
}

export const ADMIN_EMAIL = "leudyfeliz81@gmail.com";

/** Turns database credit errors into Spanish messages. */
export function creditErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  if (msg.includes("INSUFFICIENT_CREDITS")) return "No tienes créditos suficientes. Compra más en la tienda.";
  if (msg.includes("NOT_AUTHENTICATED")) return "Inicia sesión para continuar.";
  return "No se pudieron descontar los créditos.";
}
