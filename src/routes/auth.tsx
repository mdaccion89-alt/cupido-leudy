import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Heart, KeyRound, Loader2, Mail, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";
import heroWaves from "@/assets/hero-waves.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BRAND, SLOGAN } from "@/lib/cupido";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: { ref?: string }) => ({ ref: typeof search.ref === "string" ? search.ref : "" }),
  head: () => ({
    meta: [
      { title: `Iniciar sesión — ${BRAND}` },
      {
        name: "description",
        content: `Entra en ${BRAND} para ${SLOGAN.toLowerCase()}, chatear y recibir regalos.`,
      },
      { property: "og:title", content: `Iniciar sesión — ${BRAND}` },
      {
        property: "og:description",
        content: `${SLOGAN}. Chat, llamadas en vivo y verificación azul.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function normalizePhone(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function AuthPage() {
  const { session } = useAuth();
  const { ref } = Route.useSearch();
  const navigate = useNavigate();
  const referralHandled = useRef(false);
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestUsed, setGuestUsed] = useState(false);

  useEffect(() => {
    if (!ref || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref)) return;
    window.localStorage.setItem("cupido_referrer", ref);
  }, [ref]);

  useEffect(() => {
    if (!session || referralHandled.current) return;
    const referrer = window.localStorage.getItem("cupido_referrer");
    if (!referrer) return;
    referralHandled.current = true;
    void supabase.rpc("cupido_register_referral", { _referrer: referrer }).finally(() => {
      window.localStorage.removeItem("cupido_referrer");
    });
  }, [session]);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  useEffect(() => {
    setGuestUsed(window.localStorage.getItem("guest_used") === "true");
  }, []);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      toast.success("Sesión iniciada ❤️");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    if (!email.trim() || password.length < 6) {
      toast.error("Escribe tu correo y una contraseña de al menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: ref ? `${window.location.origin}/auth?ref=${ref}` : window.location.origin },
      });
      if (error) throw error;
      toast.success(
        data.session ? "Cuenta creada. ¡Bienvenido!" : "Cuenta creada. Ya puedes entrar con tu correo.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  };

  const sendPasswordReset = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      toast.error("Escribe tu correo para recibir el enlace de recuperación.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      setRecoverySent(true);
      toast.success(`Te enviamos el enlace de recuperación a ${address}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el enlace de recuperación.");
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    const normalized = normalizePhone(phone);
    if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
      toast.error("Escribe tu teléfono con código de país, por ejemplo +18095551234.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setPhone(normalized);
      setOtpSent(true);
      toast.success("Te enviamos un código por SMS.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el código.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) {
      toast.error("Escribe el código que recibiste por SMS.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: normalizePhone(phone),
        token: otp.trim(),
        type: "sms",
      });
      if (error) throw error;
      toast.success("Teléfono verificado ❤️");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "El código no es válido.");
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: ref ? `${window.location.origin}/auth?ref=${ref}` : window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo conectar con Google.");
      setBusy(false);
    }
  };

  const enterAsGuest = async () => {
    if (guestUsed || window.localStorage.getItem("guest_used") === "true") {
      setGuestUsed(true);
      toast.error("Ya usaste tu prueba de invitado. Crea una cuenta para seguir conectando.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      window.localStorage.setItem("guest_used", "true");
      setGuestUsed(true);
      toast.success("Entraste como invitado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo entrar como invitado.");
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
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/40" />

      <div className="panel grain relative w-full max-w-md animate-float-in p-8">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver a Cupido
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
            <Heart className="size-5 fill-white text-white" />
          </span>
          <span className="font-display text-lg font-semibold">{BRAND}</span>
        </div>

        <h1 className="text-2xl font-semibold">Entra a Cupido</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Correo, teléfono con código SMS, Google o invitado. Personas reales, conexiones reales.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setMode("email")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
              mode === "email" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
            }`}
          >
            <Mail className="h-4 w-4" /> Correo
          </button>
          <button
            type="button"
            onClick={() => setMode("phone")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
              mode === "phone" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
            }`}
          >
            <Phone className="h-4 w-4" /> Teléfono
          </button>
        </div>

        {mode === "email" ? (
          <form onSubmit={signIn} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setRecoverySent(false);
                }}
                className="h-11 rounded-xl bg-surface/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-xl bg-surface/80"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Button type="submit" className="h-12 rounded-xl" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Entrar
              </Button>
              <Button type="button" variant="glass" className="h-12 rounded-xl" disabled={busy} onClick={signUp}>
                Crear cuenta
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono con código de país</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="+1 809 555 1234"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={otpSent}
                className="h-11 rounded-xl bg-surface/80"
              />
            </div>
            {otpSent && (
              <div className="space-y-2">
                <Label htmlFor="otp">Código SMS</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  className="h-11 rounded-xl bg-surface/80"
                />
              </div>
            )}
            <Button
              type="button"
              className="h-12 w-full rounded-xl"
              disabled={busy}
              onClick={() => void (otpSent ? verifyOtp() : sendOtp())}
            >
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {otpSent ? "Verificar código" : "Enviar código por SMS"}
            </Button>
            {otpSent && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => {
                  setOtpSent(false);
                  setOtp("");
                }}
              >
                Cambiar número
              </button>
            )}
          </div>
        )}

        <div className="mt-3 text-center">
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendPasswordReset()}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            ¿Olvidé mi contraseña?
          </button>
          {recoverySent && (
            <p className="mt-2 text-xs text-emerald-300">
              Te enviamos el enlace de recuperación a {email.trim()}. Revisa tu correo.
            </p>
          )}
        </div>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          o continúa con
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            variant="google"
            className="h-12 w-full rounded-xl"
            disabled={busy}
            onClick={continueWithGoogle}
          >
            {busy ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            Continuar con Google
          </Button>
          <Button
            type="button"
            variant="glass"
            className="h-12 w-full rounded-xl"
            disabled={busy || guestUsed}
            onClick={enterAsGuest}
          >
            <UserRound />
            {guestUsed ? "Prueba usada · Crea una cuenta" : "Entrar como invitado"}
          </Button>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          El invitado puede probar una sola vez. Al continuar aceptas el Manual de Uso y Normas de
          Cupido Leudy.
        </p>
      </div>
    </div>
  );
}
