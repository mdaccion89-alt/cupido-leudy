import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { LovableMark } from "@lovable.dev/cloud-auth-js/react";
import { toast } from "sonner";
import heroWaves from "@/assets/hero-waves.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Equalizer } from "@/components/studio/equalizer";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Leudy IA Adobe" },
      { name: "description", content: "Entra en Leudy IA Adobe para crear y guardar tus canciones generadas con IA." },
      { property: "og:title", content: "Iniciar sesión — Leudy IA Adobe" },
      { property: "og:description", content: "Crea una cuenta y guarda tus canciones hechas con inteligencia artificial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="!size-[18px]">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}

function AuthPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setSent(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("Invalid login") ? "Correo o contraseña incorrectos." : msg || "No se pudo continuar.",
      );
    } finally {
      setBusy(false);
    }
  };

  const social = async (provider: "google" | "lovable") => {
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
    if (result.error) toast.error("No se pudo iniciar sesión. Inténtalo de nuevo.");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <img src={heroWaves} alt="" width={1920} height={1088} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />

      <div className="panel grain relative w-full max-w-md animate-float-in p-8">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
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

        {sent ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold">Revisa tu correo</h1>
            <p className="text-muted-foreground">
              Te enviamos un enlace a <span className="text-foreground">{email}</span> para confirmar tu cuenta.
            </p>
            <Button variant="glass" className="w-full" onClick={() => { setSent(false); setMode("signin"); }}>
              Ya lo confirmé, iniciar sesión
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{mode === "signin" ? "Bienvenido de nuevo" : "Crea tu cuenta"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signin" ? "Entra para seguir creando música." : "Guarda todas tus canciones en un solo lugar."}
            </p>

            <div className="mt-6 grid gap-2">
              <Button variant="google" className="h-11 w-full rounded-xl" onClick={() => social("google")}>
                <GoogleLogo />
                Continuar con Google
              </Button>
              <Button variant="glass" className="h-11 w-full rounded-xl" onClick={() => social("lovable")}>
                <LovableMark />
                Continuar con Lovable
              </Button>
            </div>

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> o con tu correo <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl bg-surface/80" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input id="password" type="password" required minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl bg-surface/80" />
              </div>
              <Button type="submit" variant="hero" className="h-12 w-full rounded-xl" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "signin" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
              <button type="button" className="text-primary hover:underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
                {mode === "signin" ? "Regístrate" : "Inicia sesión"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
