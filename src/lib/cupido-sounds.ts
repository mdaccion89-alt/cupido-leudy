import { supabase } from "@/integrations/supabase/client";

export type CupidoSound = "message-sent" | "message-received" | "notification" | "incoming-call" | "outgoing-call";

const preferenceCache = new Map<string, { enabled: boolean; expires: number }>();
let context: AudioContext | null = null;

const notes: Record<CupidoSound, Array<[number, number, number]>> = {
  "message-sent": [[587, 0, 0.09], [784, 0.1, 0.13]],
  "message-received": [[659, 0, 0.14], [523, 0.17, 0.19]],
  notification: [[880, 0, 0.11], [1175, 0.12, 0.18]],
  "incoming-call": [[659, 0, 0.2], [784, 0.23, 0.2], [659, 0.46, 0.2]],
  "outgoing-call": [[523, 0, 0.2], [659, 0.23, 0.2]],
};

async function allowedFor(userId?: string | null): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!userId) return window.localStorage.getItem("cupido-sounds") !== "false";
  const cached = preferenceCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.enabled;
  try {
    const { data, error } = await supabase.from("profiles").select("sounds_enabled").eq("id", userId).maybeSingle();
    const enabled = error ? window.localStorage.getItem("cupido-sounds") !== "false" : data?.sounds_enabled !== false;
    preferenceCache.set(userId, { enabled, expires: Date.now() + 15_000 });
    window.localStorage.setItem("cupido-sounds", String(enabled));
    return enabled;
  } catch {
    return window.localStorage.getItem("cupido-sounds") !== "false";
  }
}

export function updateCupidoSoundPreference(userId: string, enabled: boolean) {
  preferenceCache.set(userId, { enabled, expires: Date.now() + 60_000 });
  if (typeof window !== "undefined") window.localStorage.setItem("cupido-sounds", String(enabled));
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}

export function unlockCupidoAudio() {
  const audio = getAudioContext();
  if (audio?.state === "suspended") void audio.resume().catch(() => undefined);
}

if (typeof window !== "undefined") {
  const unlockOnce = () => unlockCupidoAudio();
  window.addEventListener("pointerdown", unlockOnce, { once: true, passive: true });
  window.addEventListener("keydown", unlockOnce, { once: true });
}

async function playPattern(kind: CupidoSound) {
  const audio = getAudioContext();
  if (!audio) return;
  if (audio.state === "suspended") await audio.resume().catch(() => undefined);
  const now = audio.currentTime;
  for (const [frequency, offset, duration] of notes[kind]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.045, now + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + duration + 0.02);
  }
}

export async function playCupidoSound(kind: CupidoSound, userId?: string | null) {
  if (await allowedFor(userId)) await playPattern(kind).catch(() => undefined);
}

export function startCupidoRingtone(kind: "incoming-call" | "outgoing-call", userId?: string | null) {
  let stopped = false;
  let timer: number | null = null;
  void allowedFor(userId).then((enabled) => {
    if (!enabled || stopped) return;
    void playPattern(kind).catch(() => undefined);
    timer = window.setInterval(() => void playPattern(kind).catch(() => undefined), 2_200);
  });
  return () => {
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
  };
}
