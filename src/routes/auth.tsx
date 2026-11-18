import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import heroWaves from "@/assets/hero-waves.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Equalizer } from "@/components/studio/equalizer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Leudy IA Adobe" },
      {
        name: "description",
        content: "Entra en Leudy IA Adobe para crear y guardar tus canciones generadas con IA.",
      },
      { property: "og:title", content: "Iniciar sesión — Leudy IA Adobe" },
      {
        property: "og:description",
        content: "Crea una cuenta y guarda todas tus canciones hechas con inteligencia artificial.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setStage("code");
      setCode("");
      setCooldown(30);
      toast.success("Te enviamos un código de 6 dígitos a tu correo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el código.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: "email",
      });
      if (error) throw error;
      toast.success("Sesión iniciada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Código incorrecto o vencido.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <img
        src={heroWaves}
        alt=""
        width={1920}
        height={1088}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />

      <div className="panel grain relative w-full max-w-md animate-float-in p-8">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver al estudio
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
            <Equalizer bars={4} className="h-4 [&>span]:bg-primary-foreground [&>span]:bg-none" />
          </span>
          <span className="font-display text-lg font-semibold">
            Leudy <span className="text-primary">IA</span> Adobe
          </span>
        </div>

        {stage === "email" ? (
          <>
            <h1 className="text-2xl font-semibold">Entra con un código</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Te enviamos un código de 6 dígitos. Sin contraseñas.
            </p>

            <form onSubmit={sendCode} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl bg-surface/80"
                />
              </div>
              <Button
                type="submit"
                variant="hero"
                className="h-12 w-full rounded-xl"
                disabled={busy}
              >
                {busy && <Loader2 className="animate-spin" />}
                <Mail /> Enviar código
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Revisa tu correo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Escribe el código de 6 dígitos enviado a{" "}
              <span className="text-foreground">{email}</span>.
            </p>
            <form onSubmit={verify} className="mt-8 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="otp">Código de verificación</Label>
                <InputOTP
                  id="otp"
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  autoFocus
                  className="justify-center gap-1 sm:gap-2"
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="h-12 w-10 text-base sm:w-11" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                type="submit"
                variant="hero"
                className="h-12 w-full rounded-xl"
                disabled={busy || code.length !== 6}
              >
                {busy && <Loader2 className="animate-spin" />}
                Verificar y entrar
              </Button>
            </form>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setStage("email")}
              >
                Cambiar correo
              </button>
              <button
                type="button"
                className="text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={cooldown > 0 || busy}
                onClick={() => sendCode()}
              >
                {cooldown > 0 ? `Reenviar en ${cooldown}s` : "Reenviar código"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
