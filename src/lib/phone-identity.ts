export function normalizeLoginPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `+${digits}`;
}

export function phoneLoginEmail(phone: string): string {
  const digits = normalizeLoginPhone(phone).replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(digits)) throw new Error("PHONE_INVALID");
  return `phone-${digits}@users.cupido.invalid`;
}
