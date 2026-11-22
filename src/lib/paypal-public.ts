import { supabase } from "@/integrations/supabase/client";

const publicSettingsRpc = supabase as unknown as {
  rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** PayPal Client IDs are public browser credentials; PayPal secrets remain server-only. */
export async function loadPaypalClientId(serverClientId?: string): Promise<string> {
  if (serverClientId?.trim()) return serverClientId.trim();
  const bundledClientId = import.meta.env["VITE_PAYPAL_CLIENT_ID"]?.trim();
  if (bundledClientId) return bundledClientId;

  const { data, error } = await publicSettingsRpc.rpc("cupido_public_paypal_client_id");
  if (error) {
    console.warn("[PayPal] No se pudo leer el Client ID público de Supabase.", error.message);
    return "";
  }
  return typeof data === "string" ? data.trim() : "";
}
