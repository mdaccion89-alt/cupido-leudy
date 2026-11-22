import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServiceClient } from "@/lib/paypal-admin.server";
import { COUNTRIES } from "@/lib/cupido";
import { normalizeLoginPhone, phoneLoginEmail } from "@/lib/phone-identity";

type PhoneAccountInput = {
  phone: string;
  password: string;
  fullName: string;
  displayName: string;
  birthDate: string;
  countryCode: string;
  lookingFor: string;
  zodiac: string;
  smokes: boolean;
  drinks: boolean;
  hasKids: boolean;
  hobbies: string;
  surveyCompleted: boolean;
};

function validatePhoneAccount(input: PhoneAccountInput) {
  const countryCode = typeof input?.countryCode === "string" ? input.countryCode.trim().toUpperCase() : "";
  if (!COUNTRIES.some(([code]) => code === countryCode)) throw new Error("COUNTRY_INVALID");
  const phoneInput = typeof input?.phone === "string" ? input.phone : "";
  const phone = normalizeLoginPhone(phoneInput, countryCode);
  const password = typeof input?.password === "string" ? input.password : "";
  const fullName = typeof input?.fullName === "string" ? input.fullName.trim().slice(0, 40) : "";
  const displayName = typeof input?.displayName === "string" ? input.displayName.trim().slice(0, 40) : "";
  const birthDate = typeof input?.birthDate === "string" ? input.birthDate : "";
  if (password.length < 8 || password.length > 128) throw new Error("PASSWORD_INVALID");
  if (!fullName && !displayName) throw new Error("PROFILE_NAME_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new Error("BIRTH_DATE_INVALID");
  const born = new Date(`${birthDate}T00:00:00Z`);
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  if (Number.isNaN(born.getTime()) || born > cutoff) throw new Error("ADULT_REQUIRED");
  return {
    phone,
    password,
    fullName: fullName || displayName,
    displayName: displayName || fullName,
    birthDate,
    countryCode,
    lookingFor: String(input.lookingFor || "amistad").slice(0, 40),
    zodiac: String(input.zodiac || "").slice(0, 24),
    smokes: Boolean(input.smokes),
    drinks: Boolean(input.drinks),
    hasKids: Boolean(input.hasKids),
    hobbies: String(input.hobbies || "").trim().slice(0, 240),
    surveyCompleted: Boolean(input.surveyCompleted),
  };
}

export const createPhonePasswordAccount = createServerFn({ method: "POST" })
  .validator(validatePhoneAccount)
  .handler(async ({ data }) => {
    const admin = getSupabaseServiceClient();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: phoneLoginEmail(data.phone),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.fullName,
        display_name: data.displayName,
        birth_date: data.birthDate,
        phone: data.phone,
        country_code: data.countryCode,
        looking_for: data.lookingFor,
        zodiac: data.zodiac,
        smokes: data.smokes,
        drinks: data.drinks,
        has_kids: data.hasKids,
        hobbies: data.hobbies,
        survey_completed: data.surveyCompleted,
      },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new Error("PHONE_ALREADY_REGISTERED");
      console.error("[Auth] Phone account creation failed", { status: error.status, code: error.code, message: error.message });
      throw new Error("PHONE_ACCOUNT_CREATE_FAILED");
    }
    if (!created.user) throw new Error("PHONE_ACCOUNT_CREATE_FAILED");
    return { ok: true as const };
  });
