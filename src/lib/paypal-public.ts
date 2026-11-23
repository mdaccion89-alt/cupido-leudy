import { supabase } from "@/integrations/supabase/client";

const publicSettings = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: number) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
};
const publicSettingsRpc = supabase as unknown as {
  rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** PayPal Client IDs are public browser credentials; PayPal secrets remain server-only. */
export async function loadPaypalClientId(serverClientId?: string): Promise<string> {
  if (serverClientId?.trim()) return serverClientId.trim();
  const bundledClientId = import.meta.env["VITE_PAYPAL_CLIENT_ID"]?.trim();
  if (bundledClientId) return bundledClientId;

  const { data, error } = await publicSettings
    .from("payment_settings")
    .select("paypal_client_id")
    .eq("id", 1)
    .maybeSingle();
  const clientId = data?.["paypal_client_id"];
  if (!error && typeof clientId === "string" && clientId.trim()) return clientId.trim();

  // The database RPC exposes only the public Client ID when table-level RLS
  // hides the private PayPal Business credentials from regular buyers.
  const { data: rpcData, error: rpcError } = await publicSettingsRpc.rpc("cupido_public_paypal_client_id");
  if (rpcError) {
    console.warn("[PayPal] No se pudo leer el Client ID público de Supabase.", error?.message ?? rpcError.message);
    return "";
  }
  return typeof rpcData === "string" ? rpcData.trim() : "";
}
