import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "SUPABASE_NOT_CONFIGURED" }, 503);
  if (!geminiKey) return json({ error: "LIVE_MODERATION_NOT_CONFIGURED" }, 503);

  const authorization = request.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "NOT_AUTHENTICATED" }, 401);

  let payload: { room_id?: string; image?: string };
  try { payload = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  if (!payload.room_id || typeof payload.image !== "string" || payload.image.length > 5_500_000) return json({ error: "INVALID_FRAME" }, 400);
  const imageMatch = payload.image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!imageMatch) return json({ error: "INVALID_FRAME" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: room, error: roomError } = await admin.from("cupido_live_rooms")
    .select("id,host_id,is_live,premium_coins").eq("id", payload.room_id).maybeSingle();
  if (roomError) return json({ error: "ROOM_LOOKUP_FAILED" }, 500);
  if (!room || !room.is_live) return json({ error: "LIVE_NOT_AVAILABLE" }, 404);
  if (room.host_id !== user.id) return json({ error: "HOST_ONLY" }, 403);
  if (room.premium_coins > 0) return json({ error: "PUBLIC_LIVES_ONLY" }, 400);

  const moderationResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: "Safety review of one video frame from a public social live stream. Determine only whether the frame clearly shows nudity/sexual exposure or physical violence/injury. Reply with one exact word: SAFE, NUDITY, VIOLENCE, or UNSURE. Do not flag ordinary clothing, romance, sports, or fictional non-graphic content." },
        { inline_data: { mime_type: `image/${imageMatch[1]}`, data: imageMatch[2] } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    }),
  });
  if (!moderationResponse.ok) return json({ error: "MODERATION_PROVIDER_FAILED" }, 502);
  const result = await moderationResponse.json();
  const answer = String(result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join(" ") ?? "").trim().toUpperCase();
  const category = answer.includes("NUDITY") ? "nudity" : answer.includes("VIOLENCE") ? "violence" : null;
  if (!category) return json({ ok: true, reviewed: true, closed: false });

  const { data: closed, error: closeError } = await admin.rpc("cupido_close_moderated_live", { _room: room.id, _category: category });
  if (closeError) return json({ error: "LIVE_CLOSE_FAILED" }, 500);
  return json({ ok: true, reviewed: true, closed: Boolean(closed), category });
});
