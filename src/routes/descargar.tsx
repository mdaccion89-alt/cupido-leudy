import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, Download, Heart, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/cupido";
import { captureReferralFromUrl, normalizeReferralCode } from "@/lib/referral";

const APK_DOWNLOAD_URL = "https://github.com/mdaccion89-alt/cupido-leudy/releases/download/v3.0/app-debug.apk";

export const Route = createFileRoute("/descargar")({
  validateSearch: (search: { ref?: string }) => ({ ref: normalizeReferralCode(search.ref) }),
  head: () => ({
    meta: [
      { title: `Descargar ${BRAND} para Android` },
      { name: "description", content: "Descarga directa y segura de Cupido Leudy para Android." },
      { name: "theme-color", content: "#100910" },
    ],
  }),
  component: DownloadPage,
});

function DownloadPage() {
  const { ref } = Route.useSearch();
  const downloadLink = useRef<HTMLAnchorElement>(null);
  const started = useRef(false);
  const [referralCode, setReferralCode] = useState(ref);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const code = normalizeReferralCode(ref) || captureReferralFromUrl();
    setReferralCode(code);
    if (code) {
      try {
        window.localStorage.setItem("cupido_ref", code);
      } catch {
        // The code remains visible and can be copied if this browser blocks storage.
      }
    }
    if (started.current) return;
    const start = window.setTimeout(() => {
      started.current = true;
      downloadLink.current?.click();
      setDownloadStarted(true);
    }, 350);
    return () => window.clearTimeout(start);
  }, [ref]);

  const copyCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      toast.success("Código de invitación copiado");
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error("No se pudo copiar. Mantén pulsado el código para seleccionarlo.");
    }
  };

  return (
    <main className="download-page flex min-h-[100dvh] w-full items-center justify-center overflow-y-auto px-4 py-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white">
      <a ref={downloadLink} href={APK_DOWNLOAD_URL} download="cupido-leudy-android.apk" className="hidden" aria-hidden="true" tabIndex={-1}>
        Descargar APK de Cupido Leudy
      </a>
      <section className="w-full max-w-md overflow-hidden rounded-[2rem] border border-rose-100/10 bg-[#151018]/95 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-xl">
        <div className="relative overflow-hidden px-6 pb-6 pt-8 text-center sm:px-8">
          <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-64 -translate-x-1/2 rounded-full bg-rose-500/20 blur-[75px]" />
          <div className="relative mx-auto grid size-24 place-items-center rounded-[1.8rem] border border-rose-100/20 bg-gradient-to-br from-fuchsia-500/20 via-rose-500/20 to-amber-400/15 p-2 shadow-[0_0_44px_rgba(244,63,94,0.24)]">
            <img src="/icon-512.png" alt={`${BRAND} logo`} width={512} height={512} className="brand-logo-breathe size-full rounded-[1.35rem] object-cover" />
            <span className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-rose-100/20 bg-[#24141e] text-rose-200"><Heart className="size-4 fill-current" /></span>
          </div>
          <p className="relative mt-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-rose-200/70">Conexiones reales, en tu móvil</p>
          <h1 className="relative mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">Cupido Leudy</h1>
          <p className="relative mt-2 text-sm text-white/60">La app para conectar, chatear y compartir momentos.</p>

          <div className="relative mt-7 rounded-2xl border border-white/10 bg-black/25 p-4 text-left">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-400/10 text-rose-200"><Download className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Descargando Cupido Leudy para Android...</p>
                <p className="mt-1 text-xs text-white/50">{downloadStarted ? "La descarga debería aparecer en tus notificaciones." : "Preparando descarga directa del APK oficial…"}</p>
              </div>
            </div>
            <div className="download-progress-track mt-4" role="progressbar" aria-label="Preparando la descarga" aria-valuemin={0} aria-valuemax={100}>
              <span className="download-progress-bar" />
            </div>
          </div>

          <a href={APK_DOWNLOAD_URL} download="cupido-leudy-android.apk" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 px-4 text-sm font-bold text-white shadow-[0_10px_32px_rgba(244,63,94,0.25)] transition hover:brightness-110 active:scale-[0.99]">
            <Download className="size-4" /> Volver a descargar APK
          </a>
        </div>

        <div className="border-t border-white/10 bg-black/15 px-6 py-5 sm:px-8">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Instálala en dos pasos</p>
          <ol className="space-y-3">
            <li className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rose-400/10 text-sm font-bold text-rose-200">1</span>
              <span className="flex-1 text-sm text-white/85">Toca <strong className="font-semibold text-white">Abrir</strong> en la notificación de descarga.</span>
              <Smartphone className="size-4 shrink-0 text-white/35" />
            </li>
            <li className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-300/10 text-sm font-bold text-amber-100">2</span>
              <span className="flex-1 text-sm text-white/85">Toca <strong className="font-semibold text-white">Instalar</strong> cuando Android lo indique.</span>
              <ShieldCheck className="size-4 shrink-0 text-white/35" />
            </li>
          </ol>

          {referralCode && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-pink-300/20 bg-pink-400/[0.07] p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.16em] text-pink-100/60">Código de invitación</p>
                <p className="mt-0.5 font-mono text-lg font-bold tracking-[0.24em] text-pink-100">{referralCode}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyCode()} className="shrink-0 gap-2 border-pink-100/20 bg-pink-100/[0.06] text-pink-50 hover:bg-pink-100/10">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copiar
              </Button>
            </div>
          )}
          <p className="mt-4 text-center text-[11px] leading-relaxed text-white/40">Descarga el archivo APK oficial de Cupido Leudy para Android.</p>
          <Link to="/" className="mt-3 block text-center text-xs font-medium text-rose-200/70 hover:text-rose-100">Volver a Cupido Leudy</Link>
        </div>
      </section>
    </main>
  );
}
