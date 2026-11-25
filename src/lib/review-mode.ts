export const PLAY_STORE_REVIEW_EMAIL = "reviewer@cupidoleudy.com";
export const REVIEW_MODE_CREDITS = 10_000_000;
export const REVIEW_MODE_MESSAGE =
  "Modo Revisión / Promociones: Tienes 10,000,000 monedas de prueba activas para probar Lives, llamadas, regalos y marcos";

export function isReviewModeEmail(email?: string | null): boolean {
  return email?.trim().toLowerCase() === PLAY_STORE_REVIEW_EMAIL;
}

export function isPlayStoreReviewMode(email?: string | null): boolean {
  return import.meta.env["VITE_PLAY_STORE_BUILD"] === "true" || isReviewModeEmail(email);
}
