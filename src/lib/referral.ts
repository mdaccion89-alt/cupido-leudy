export const REFERRAL_KEY = "cupido_ref";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidReferralId(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!isValidReferralId(ref)) return;
  window.localStorage.setItem(REFERRAL_KEY, ref);
}

export function getStoredReferral(): string {
  if (typeof window === "undefined") return "";
  const ref = window.localStorage.getItem(REFERRAL_KEY);
  return isValidReferralId(ref) ? ref : "";
}

export function clearStoredReferral(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REFERRAL_KEY);
  window.localStorage.removeItem("cupido_referrer");
}

export function invitationLink(userId: string): string {
  return `${window.location.origin}/?ref=${userId}`;
}
