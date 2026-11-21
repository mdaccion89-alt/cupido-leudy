import { supabase } from "@/integrations/supabase/client";

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

export type ProfileValues = {
  displayName: string;
  fullName: string;
  bio: string;
  age: number | null;
  gender: string | null;
  countryCode: string;
  lookingFor: string;
  drinks: boolean;
  hasKids: boolean;
  birthDate: string;
  phone: string;
  zodiac: string;
  smokes: boolean;
  hobbies: string;
  surveyCompleted: boolean;
};

async function writeRow(table: "profiles" | "creator_profiles", id: string, full: Row, dropOrder: string[]): Promise<boolean> {
  const attempts: Row[] = [full];
  const current: Row = { ...full };
  for (const key of dropOrder) {
    delete current[key];
    if (Object.keys(current).length > 0) attempts.push({ ...current });
  }

  let lastError = "";
  for (const payload of attempts) {
    const record = { id, ...payload } as never;
    const update = await supabase.from(table).update(payload as never).eq("id", id);
    if (!update.error) return true;
    lastError = lastError || update.error.message;
    const upsert = await supabase.from(table).upsert(record, { onConflict: "id" });
    if (!upsert.error) return true;
    lastError = lastError || upsert.error.message;
  }
  if (lastError) throw new Error(lastError);
  return false;
}

export async function saveProfileDirect(id: string, values: ProfileValues): Promise<void> {
  const fullName = values.fullName.trim() || values.displayName.trim();
  const profilesWritten = await writeRow(
    "profiles",
    id,
    {
      display_name: values.displayName,
      full_name: fullName,
      bio: values.bio,
      age: values.age,
      gender: values.gender,
      country_code: values.countryCode,
      looking_for: values.lookingFor,
      drinks: values.drinks,
      has_kids: values.hasKids,
      birth_date: values.birthDate || null,
      phone: values.phone || null,
      zodiac: values.zodiac,
      smokes: values.smokes,
      hobbies: values.hobbies,
      survey_completed: values.surveyCompleted,
    },
    ["looking_for", "has_kids", "drinks", "zodiac", "smokes", "hobbies", "survey_completed", "birth_date", "phone", "gender", "age", "bio", "country_code", "full_name"],
  );
  const creatorWritten = await writeRow(
    "creator_profiles",
    id,
    {
      display_name: values.displayName,
      full_name: fullName,
      bio: values.bio,
      country_code: values.countryCode,
      looking_for: values.lookingFor,
      drinks: values.drinks,
      has_kids: values.hasKids,
      age: values.age,
      gender: values.gender,
      zodiac: values.zodiac,
      smokes: values.smokes,
      hobbies: values.hobbies,
      survey_completed: values.surveyCompleted,
    },
    ["full_name", "gender", "age", "looking_for", "has_kids", "drinks", "zodiac", "smokes", "hobbies", "survey_completed", "country_code", "bio"],
  );
  if (!profilesWritten || !creatorWritten) throw new Error("No se pudo guardar el perfil.");

  const { error: authError } = await supabase.auth.updateUser({
    data: {
      display_name: values.displayName,
      full_name: fullName,
    },
  });
  if (authError) throw authError;
}

export async function saveAvatarDirect(id: string, url: string, moderation: "approved" | "pending"): Promise<void> {
  const profilesWritten = await writeRow("profiles", id, { avatar_url: url }, []);
  const creatorWritten = await writeRow(
    "creator_profiles",
    id,
    { avatar_url: url, moderation_status: moderation },
    ["moderation_status"],
  );
  if (!profilesWritten || !creatorWritten) throw new Error("No se pudo guardar la foto.");
}

export function extraField(row: unknown, key: "age" | "gender" | "avatar_url" | "bio"): Cell | undefined {
  return row && typeof row === "object" ? (row as Row)[key] : undefined;
}
