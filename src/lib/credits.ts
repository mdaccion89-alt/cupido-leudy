// Credit costs and packages. Prices are charged in USD through PayPal.
export const CREDIT_COSTS = { song: 1, cover: 2, video: 5 } as const;
export type CreationKind = keyof typeof CREDIT_COSTS;

export const FREE_SIGNUP_CREDITS = 3;

export const CREDIT_PACKAGES = [
  { id: "pack-10", credits: 10, price: "4.99", label: "Inicial" },
  { id: "pack-30", credits: 30, price: "12.99", label: "Creador", featured: true },
  { id: "pack-100", credits: 100, price: "34.99", label: "Estudio" },
] as const;
export type CreditPackage = (typeof CREDIT_PACKAGES)[number];

export function findPackage(id: unknown): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}

export const ADMIN_EMAIL = "leudyfeliz81@gmail.com";

/** Turns database credit errors into Spanish messages. */
export function creditErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  if (msg.includes("INSUFFICIENT_CREDITS")) return "No tienes créditos suficientes. Compra más en la sección Comprar Créditos.";
  if (msg.includes("NOT_AUTHENTICATED")) return "Inicia sesión para continuar.";
  return "No se pudieron descontar los créditos.";
}
