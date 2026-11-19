import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import heroWaves from "@/assets/hero-waves.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function AuthPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      toast.success("Sesión iniciada.");
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
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast.success(
        data.session
          ? "Cuenta creada. ¡Bienvenido!"
          : "Cuenta creada. Ya puedes entrar con tu correo y contraseña.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo conectar con Google.");
      setBusy(false);
    }
  };

  const enterAsGuest = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
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

        <h1 className="text-2xl font-semibold">Entra a tu estudio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Correo y contraseña, Google o invitado. Sin códigos por correo.
        </p>

        <form onSubmit={signIn} className="mt-8 space-y-4">
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
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl bg-surface/80"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button type="submit" variant="hero" className="h-12 rounded-xl" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Entrar
            </Button>
            <Button
              type="button"
              variant="glass"
              className="h-12 rounded-xl"
              disabled={busy}
              onClick={signUp}
            >
              Crear cuenta
            </Button>
          </div>
        </form>

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
            disabled={busy}
            onClick={enterAsGuest}
          >
            <UserRound /> Entrar como invitado
          </Button>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          El invitado puede crear al instante. Inicia sesión para guardar tus canciones.
        </p>
      </div>
    </div>
  );
}
