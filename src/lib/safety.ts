import { supabase } from "@/integrations/supabase/client";

type SafetyRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const safetyRpc = supabase.rpc as unknown as SafetyRpc;

export async function reportUser(targetId: string, reason: string, postId?: string): Promise<void> {
  const { error } = await safetyRpc("cupido_report_user", {
    _target: targetId,
    _reason: reason,
    _post: postId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function blockUser(targetId: string): Promise<void> {
  const { error } = await safetyRpc("cupido_block_user", { _target: targetId, _blocked: true });
  if (error) throw new Error(error.message);
}

export async function fetchBlockedUserIds(viewerId: string | null): Promise<string[]> {
  if (!viewerId) return [];
  let rpcError: unknown = null;
  try {
    const { data, error } = await safetyRpc("cupido_get_blocked_users");
    if (!error && Array.isArray(data)) {
      return data.filter((id): id is string => typeof id === "string");
    }
    rpcError = error;
  } catch (error) {
    rpcError = error;
  }

  // An unavailable optional block RPC must never take down the public media feed.
  try {
    const blockDb = supabase as unknown as { from: (table: string) => any };
    const result = await blockDb.from("cupido_user_blocks").select("blocked_id").eq("blocker_id", viewerId);
    if (!result.error) return (result.data ?? []).map((row: { blocked_id: string }) => row.blocked_id);
    console.warn("[safety] No se pudieron cargar los bloqueos; se continúa mostrando el feed.", rpcError, result.error);
  } catch (fallbackError) {
    console.warn("[safety] La lista de bloqueos no está disponible; se continúa mostrando el feed.", rpcError, fallbackError);
  }
  return [];
}
