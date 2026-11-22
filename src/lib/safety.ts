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
  const { data, error } = await safetyRpc("cupido_get_blocked_users");
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
}
