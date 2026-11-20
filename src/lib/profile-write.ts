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
};

async function writeRow(table: "profiles" | "creator_profiles", id: string, full: Row, dropOrder: string[]): Promise<boolean> {
  const attempts: Row[] = [full];
  const current: Row = { ...full };
  for (const key of dropOrder) {
    delete current[key];
    if (Object.keys(current).length > 0) attempts.push({ ...current });
  }

  for (const payload of attempts) {
    const record = { id, ...payload } as never;
    const upsert = await supabase.from(table).upsert(record, { onConflict: "id" });
    if (!upsert.error) return true;
    const update = await supabase.from(table).update(payload as never).eq("id", id);
    if (!update.error) return true;
  }
  return false;
}

export async function saveProfileDirect(id: string, values: ProfileValues): Promise<void> {
  const profilesWritten = await writeRow(
    "profiles",
    id,
    {
      display_name: values.displayName,
      full_name: values.fullName || null,
      bio: values.bio,
      age: values.age,
      gender: values.gender,
      country_code: values.countryCode,
      looking_for: values.lookingFor,
      drinks: values.drinks,
      has_kids: values.hasKids,
    },
    ["looking_for", "has_kids", "drinks", "gender", "age", "bio", "country_code", "full_name"],
  );
  const creatorWritten = await writeRow(
    "creator_profiles",
    id,
    {
      display_name: values.displayName,
      bio: values.bio,
      country_code: values.countryCode,
      looking_for: values.lookingFor,
      drinks: values.drinks,
      has_kids: values.hasKids,
      age: values.age,
      gender: values.gender,
    },
    ["gender", "age", "looking_for", "has_kids", "drinks", "country_code", "bio"],
  );
  if (!profilesWritten && !creatorWritten) throw new Error("No se pudo guardar el perfil.");
}

export async function saveAvatarDirect(id: string, url: string, moderation: "approved" | "pending"): Promise<void> {
  const creatorWritten = await writeRow(
    "creator_profiles",
    id,
    { avatar_url: url, moderation_status: moderation },
    ["moderation_status"],
  );
  const profilesWritten = await writeRow("profiles", id, { avatar_url: url }, []);
  if (!creatorWritten && !profilesWritten) throw new Error("No se pudo guardar la foto.");
}

export function extraField(row: unknown, key: "age" | "gender" | "avatar_url" | "bio"): Cell | undefined {
  return row && typeof row === "object" ? (row as Row)[key] : undefined;
}
