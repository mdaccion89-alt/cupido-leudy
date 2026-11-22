import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_PROJECT_URL = "https://grlypsxivgxrvahnjoay.supabase.co";

let serviceClient: SupabaseClient<Database> | undefined;

/** Trusted server operations must use service_role, never the public key. */
export function getSupabaseServiceClient(): SupabaseClient<Database> {
  if (serviceClient) return serviceClient;

  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY_MISSING");

  const url = process.env["SUPABASE_URL"]?.trim() || SUPABASE_PROJECT_URL;
  serviceClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return serviceClient;
}

/** Backwards-compatible alias for the existing PayPal server handlers. */
export const getPaypalServiceClient = getSupabaseServiceClient;
