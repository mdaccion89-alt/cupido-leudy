export const REFERRAL_KEY = "cupido_ref";

const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeReferralCode(value: string | null | undefined): string {
  const code = value?.trim().toUpperCase() ?? "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : "";
}

export function isValidReferralCode(value: string | null | undefined): value is string {
  return Boolean(normalizeReferralCode(value));
}

export function captureReferralFromUrl(): string {
  if (typeof window === "undefined") return "";
  const code = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
  if (!code) return "";
  try {
    window.localStorage.setItem(REFERRAL_KEY, code);
  } catch {
    // The signup field can still keep the code in memory if storage is disabled.
  }
  return code;
}

export function getStoredReferral(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeReferralCode(window.localStorage.getItem(REFERRAL_KEY));
  } catch {
    return "";
  }
}

export function clearStoredReferral(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REFERRAL_KEY);
    window.localStorage.removeItem("cupido_referrer");
  } catch {
    // Storage may be disabled by the browser.
  }
}

export function invitationLink(referralCode: string): string {
  const code = normalizeReferralCode(referralCode);
  return `https://leudyia.onrender.com/descargar?ref=${encodeURIComponent(code)}`;
}
