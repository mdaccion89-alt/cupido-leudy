import { createClient } from "jsr:@supabase/supabase-js@2";

const EXPECTED_AD_UNIT = "ca-app-pub-9590752647129001/6042940724";
const EXPECTED_REWARD = 15;
const GOOGLE_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

type GoogleVerifierKey = { keyId: number; pem: string };
let verifierKeys: { expiresAt: number; keys: GoogleVerifierKey[] } | null = null;

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function derEcdsaToRaw(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) return signature;
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error("INVALID_SIGNATURE_FORMAT");
  const sequenceLength = signature[offset++];
  if (sequenceLength === undefined) throw new Error("INVALID_SIGNATURE_FORMAT");
  if ((sequenceLength & 0x80) !== 0) offset += (sequenceLength & 0x7f);
  if (signature[offset++] !== 0x02) throw new Error("INVALID_SIGNATURE_FORMAT");
  const rLength = signature[offset++];
  if (rLength === undefined) throw new Error("INVALID_SIGNATURE_FORMAT");
  let r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) throw new Error("INVALID_SIGNATURE_FORMAT");
  const sLength = signature[offset++];
  if (sLength === undefined) throw new Error("INVALID_SIGNATURE_FORMAT");
  let s = signature.slice(offset, offset + sLength);
  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);
  if (r.length > 32 || s.length > 32) throw new Error("INVALID_SIGNATURE_FORMAT");
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

async function fetchVerifierKeys(): Promise<GoogleVerifierKey[]> {
  if (verifierKeys && verifierKeys.expiresAt > Date.now()) return verifierKeys.keys;
  const result = await fetch(GOOGLE_KEYS_URL, { cache: "no-store" });
  if (!result.ok) throw new Error("GOOGLE_KEYS_UNAVAILABLE");
  const payload = await result.json() as { keys?: GoogleVerifierKey[] };
  const keys = Array.isArray(payload.keys)
    ? payload.keys.filter((key) => Number.isFinite(Number(key.keyId)) && typeof key.pem === "string")
    : [];
  if (!keys.length) throw new Error("GOOGLE_KEYS_INVALID");
  verifierKeys = { keys, expiresAt: Date.now() + 60 * 60_000 };
  return keys;
}

async function verifySignature(key: GoogleVerifierKey, signedData: string, signature: string): Promise<boolean> {
  const pemBody = key.pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const spki = decodeBase64(pemBody);
  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    derEcdsaToRaw(decodeBase64(signature)),
    new TextEncoder().encode(signedData),
  );
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return response("METHOD_NOT_ALLOWED", 405);

  const callbackUrl = new URL(request.url);
  const query = callbackUrl.search.slice(1);
  const signatureMarker = "&signature=";
  const signatureOffset = query.indexOf(signatureMarker);
  if (signatureOffset < 0) return response("SIGNATURE_MISSING", 400);
  const signedData = query.slice(0, signatureOffset);
  const parameters = callbackUrl.searchParams;
  const signature = parameters.get("signature") ?? "";
  const keyId = Number(parameters.get("key_id"));
  const userId = parameters.get("user_id") ?? "";
  const sessionId = parameters.get("custom_data") ?? "";
  const transactionId = parameters.get("transaction_id") ?? "";
  const rewardAmount = Number(parameters.get("reward_amount"));
  const adUnit = parameters.get("ad_unit") ?? "";
  const timestamp = Number(parameters.get("timestamp"));

  if (!signature || !Number.isFinite(keyId) || !userId || !sessionId || !transactionId || !Number.isFinite(timestamp)) {
    return response("CALLBACK_INVALID", 400);
  }
  if (adUnit !== EXPECTED_AD_UNIT || rewardAmount !== EXPECTED_REWARD) return response("REWARD_MISMATCH", 400);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(sessionId)) return response("IDENTIFIER_INVALID", 400);
  const callbackTime = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  if (callbackTime > Date.now() + 5 * 60_000 || callbackTime < Date.now() - 24 * 60 * 60_000) {
    return response("CALLBACK_EXPIRED", 400);
  }

  try {
    const key = (await fetchVerifierKeys()).find((item) => Number(item.keyId) === keyId);
    if (!key || !(await verifySignature(key, signedData, signature))) return response("SIGNATURE_INVALID", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) return response("SERVER_NOT_CONFIGURED", 503);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc("cupido_admob_confirm_reward", {
      _session_id: sessionId,
      _user_id: userId,
      _transaction_id: transactionId,
      _reward_amount: rewardAmount,
    });
    if (error) {
      console.error("AdMob SSV reward confirmation failed", error.message);
      return response("REWARD_CONFIRMATION_FAILED", 500);
    }
    return response("OK");
  } catch (error) {
    console.error("AdMob SSV verification failed", error);
    return response("VERIFICATION_FAILED", 500);
  }
});
