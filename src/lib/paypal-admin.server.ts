import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_PROJECT_URL = "https://grlypsxivgxrvahnjoay.supabase.co";

let serviceClient: SupabaseClient<Database> | undefined;

/** PayPal orders and the capture finalizer must run as service_role, never with the public key. */
export function getPaypalServiceClient(): SupabaseClient<Database> {
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
