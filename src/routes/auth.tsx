import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Heart, KeyRound, Loader2, Mail, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import heroWaves from "@/assets/hero-waves.jpg";
import { Button } from "@/components/ui/button";
import { LegalLinks } from "@/components/cupido/legal-links";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useAppLogo } from "@/lib/app-logo";
import { BRAND, COUNTRIES, LOOKING_FOR, SLOGAN, countryFlag } from "@/lib/cupido";
import { captureReferralFromUrl } from "@/lib/referral";
import { createPhonePasswordAccount } from "@/lib/phone-auth.functions";
import { phoneLoginEmail } from "@/lib/phone-identity";

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

function authRedirectUrl(ref: string): string {
  if (Capacitor.isNativePlatform()) {
    const callback = new URL("com.cupido.leudy://auth");
    if (ref) callback.searchParams.set("ref", ref);
    return callback.toString();
  }
  const callback = new URL("/auth", window.location.origin);
  if (ref) callback.searchParams.set("ref", ref);
  return callback.toString();
}

function oauthRedirectUrl(ref: string): string {
  const callback = new URL(Capacitor.isNativePlatform() ? "com.cupido.leudy://auth" : "/auth", window.location.origin);
  if (ref) callback.searchParams.set("ref", ref);
  return callback.toString();
}

function normalizePhone(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

const PHONE_PREFIXES: Record<string, string> = {
  DO: "1", US: "1", CA: "1", PR: "1", JM: "1", TT: "1", BO: "591", MX: "52",
  AR: "54", BR: "55", CL: "56", CO: "57", VE: "58", PE: "51", EC: "593",
  ES: "34", GB: "44", FR: "33", DE: "49", IT: "39", PT: "351", AU: "61",
  IN: "91", JP: "81", CN: "86", NG: "234", ZA: "27", PH: "63", PA: "507",
  CR: "506", GT: "502", HN: "504", SV: "503", NI: "505", PY: "595", UY: "598",
};

function limitProfileName(value: string): string {
  return Array.from(value).slice(0, 40).join("");
}

function validSignupNames(fullName: string, displayName: string): boolean {
  return [fullName.trim(), displayName.trim()].every((name) => name.length <= 40)
    && Boolean(fullName.trim() || displayName.trim());
}

function isAdultDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const birthDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return birthDate <= cutoff;
}

function AuthPage() {
  const { session } = useAuth();
  const appLogo = useAppLogo();
  const { ref } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestUsed, setGuestUsed] = useState(false);
  const [signupStep, setSignupStep] = useState<0 | 1 | 2>(0);
  const [phoneSignup, setPhoneSignup] = useState(false);
  const [phoneSurveySkipped, setPhoneSurveySkipped] = useState(false);
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [countryCode, setCountryCode] = useState("DO");
  const [lookingFor, setLookingFor] = useState("amistad");
  const [zodiac, setZodiac] = useState("");
  const [smokes, setSmokes] = useState(false);
  const [drinks, setDrinks] = useState(false);
  const [hasKids, setHasKids] = useState(false);
  const [hobbies, setHobbies] = useState("");

  useEffect(() => {
    captureReferralFromUrl();
  }, [ref]);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  useEffect(() => {
    setGuestUsed(window.localStorage.getItem("guest_used") === "true");
  }, []);

  useEffect(() => {
    const detected = window.localStorage.getItem("cupido-country-code")?.toUpperCase();
    if (!detected || !COUNTRIES.some(([code]) => code === detected)) return;
    setCountryCode(detected);
    if (!phone) setPhone(`+${PHONE_PREFIXES[detected] ?? "1"} `);
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

  const signUp = () => setSignupStep(1);

  const finishSignup = async (skipSurvey: boolean) => {
    if (!email.trim() || password.length < 6) {
      toast.error("Escribe tu correo y una contraseña de al menos 6 caracteres.");
      return;
    }
    if (!validSignupNames(fullName, displayName)) {
      toast.error("Escribe un nombre o apodo de hasta 40 caracteres.");
      setSignupStep(1);
      return;
    }
    if (!isAdultDate(birthDate)) {
      toast.error("Debes tener al menos 18 años. Revisa tu fecha de nacimiento.");
      setSignupStep(1);
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (!/^\+[1-9]\d{6,14}$/.test(normalizedPhone)) {
      toast.error("Escribe tu teléfono con código de país, por ejemplo +18095551234.");
      setSignupStep(1);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: authRedirectUrl(ref),
          data: {
            full_name: fullName.trim() || displayName.trim(),
            display_name: displayName.trim() || fullName.trim(),
            birth_date: birthDate,
            phone: normalizedPhone,
            country_code: countryCode,
            looking_for: skipSurvey ? "amistad" : lookingFor,
            zodiac: skipSurvey ? "" : zodiac,
            smokes: skipSurvey ? false : smokes,
            drinks: skipSurvey ? false : drinks,
            has_kids: skipSurvey ? false : hasKids,
            hobbies: skipSurvey ? "" : hobbies.trim(),
            survey_completed: !skipSurvey,
          },
        },
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
        redirectTo: authRedirectUrl(ref),
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

  const continueWithPhonePassword = async () => {
    const normalizedPhone = normalizePhone(phone);
    if (!/^\+[1-9]\d{6,14}$/.test(normalizedPhone)) {
      toast.error("Escribe tu telefono con codigo de pais, por ejemplo +18095551234.");
      return;
    }
    if (phonePassword.length < 8) {
      toast.error("La contrasena debe tener al menos 8 caracteres.");
      return;
    }
    if (phoneSignup && (!validSignupNames(fullName, displayName) || !isAdultDate(birthDate))) {
      toast.error("Para crear la cuenta, completa tu nombre y confirma que tienes 18 anos o mas.");
      return;
    }
    setBusy(true);
    try {
      if (phoneSignup) {
        const result = await createPhonePasswordAccount({ data: {
          phone: normalizedPhone,
          password: phonePassword,
          fullName: fullName.trim() || displayName.trim(),
          displayName: displayName.trim() || fullName.trim(),
          birthDate,
          countryCode,
          lookingFor: phoneSurveySkipped ? "amistad" : lookingFor,
          zodiac: phoneSurveySkipped ? "" : zodiac,
          smokes: phoneSurveySkipped ? false : smokes,
          drinks: phoneSurveySkipped ? false : drinks,
          hasKids: phoneSurveySkipped ? false : hasKids,
          hobbies: phoneSurveySkipped ? "" : hobbies.trim(),
          surveyCompleted: !phoneSurveySkipped,
        } });
        if (!result.ok) throw new Error("PHONE_ACCOUNT_CREATE_FAILED");
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: phoneLoginEmail(normalizedPhone),
        password: phonePassword,
      });
      if (error) throw error;
      toast.success(phoneSignup ? "Cuenta creada y sesion iniciada." : "Sesion iniciada.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo acceder con telefono.";
      toast.error(message.includes("PHONE_ALREADY_REGISTERED")
        ? "Ese telefono ya tiene cuenta. Inicia sesion con tu contrasena."
        : message.includes("PHONE_ACCOUNT_CREATE_FAILED")
          ? "No se pudo crear la cuenta con ese telefono. Intenta de nuevo."
          : message.includes("Invalid login credentials")
            ? "El telefono o la contrasena no coinciden."
            : message);
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    setBusy(true);
    try {
      const native = Capacitor.isNativePlatform();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: oauthRedirectUrl(ref), ...(native ? { skipBrowserRedirect: true } : {}) },
      });
      if (error) throw error;
      if (native) {
        if (!data.url) throw new Error("No se pudo iniciar el acceso de Google dentro de Cupido Leudy.");
        await Browser.open({ url: data.url });
        setBusy(false);
      }
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

  const continueSignup = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 6) {
      toast.error("Escribe un correo válido y una contraseña de al menos 6 caracteres.");
      return;
    }
    if (!validSignupNames(fullName, displayName)) {
      toast.error("Escribe un nombre o apodo de hasta 40 caracteres.");
      return;
    }
    if (!isAdultDate(birthDate)) {
      toast.error("Debes tener al menos 18 años. Revisa tu fecha de nacimiento.");
      return;
    }
    if (!/^\+[1-9]\d{6,14}$/.test(normalizePhone(phone))) {
      toast.error("Escribe tu teléfono con código de país, por ejemplo +18095551234.");
      return;
    }
    setSignupStep(2);
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
          <span className="flex size-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-primary shadow-glow">
            {appLogo ? <img src={appLogo} alt="" className="size-full object-contain" /> : <Heart className="size-5 fill-white text-white" />}
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

        {mode === "email" && signupStep > 0 ? (
          <section className="mt-6 space-y-4 rounded-2xl border border-pink-400/20 bg-black/20 p-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-pink-200">Paso {signupStep} de 2</p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {signupStep === 1 ? "Completa tu perfil para crear la cuenta" : "Cuéntanos un poco más (opcional)"}
              </h2>
            </div>
            {signupStep === 1 ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Correo electrónico</Label>
                  <Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Contraseña (mínimo 6 caracteres)</Label>
                  <Input id="signup-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Nombre completo</Label>
                  <Input id="signup-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(limitProfileName(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-nickname">Apodo público (opcional)</Label>
                  <Input id="signup-nickname" value={displayName} onChange={(event) => setDisplayName(limitProfileName(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-birth-date">Fecha de nacimiento (debes tener 18 años o más)</Label>
                  <Input id="signup-birth-date" type="date" max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>País</Label>
                  <Select value={countryCode} onValueChange={setCountryCode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map(([code, name]) => <SelectItem key={code} value={code}>{countryFlag(code)} {name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-phone">Teléfono con código de país</Label>
                  <Input id="signup-phone" type="tel" autoComplete="tel" placeholder="+1 809 555 1234" value={phone} onChange={(event) => setPhone(event.target.value)} />
                </div>
                <Button type="button" className="w-full" disabled={busy} onClick={continueSignup}>Continuar</Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>¿Qué buscas?</Label>
                  <Select value={lookingFor} onValueChange={setLookingFor}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOOKING_FOR.map((item) => <SelectItem key={item.value} value={item.value}>{item.emoji} {item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Signo zodiacal</Label>
                  <Select value={zodiac || "sin-especificar"} onValueChange={(value) => setZodiac(value === "sin-especificar" ? "" : value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo", "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"].map((sign) => <SelectItem key={sign} value={sign}>{sign}</SelectItem>)}
                      <SelectItem value="sin-especificar">Prefiero omitirlo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smokes} onChange={(event) => setSmokes(event.target.checked)} /> ¿Fumas?</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={drinks} onChange={(event) => setDrinks(event.target.checked)} /> ¿Tomas alcohol?</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasKids} onChange={(event) => setHasKids(event.target.checked)} /> ¿Tienes hijos?</label>
                <div className="space-y-2">
                  <Label htmlFor="signup-hobbies">Pasatiempos favoritos (opcional)</Label>
                  <Input id="signup-hobbies" maxLength={240} placeholder="Música, baile, senderismo…" value={hobbies} onChange={(event) => setHobbies(event.target.value)} />
                </div>
                <div className="flex flex-wrap justify-between gap-2 pt-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setSignupStep(1)}>Atrás</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void finishSignup(true)}>Omitir encuesta</Button>
                  <Button type="button" disabled={busy} onClick={() => void finishSignup(false)}>
                    {busy && <Loader2 className="animate-spin" />} Crear cuenta
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : mode === "email" ? (
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
                className="h-11 rounded-xl bg-surface/80"
              />
            </div>
            <Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={() => setPhoneSignup((value) => !value)}>
              {phoneSignup ? "Ya tengo una cuenta con teléfono" : "Crear una cuenta nueva con teléfono"}
            </Button>
            {phoneSignup && (
              <div className="space-y-3 rounded-xl border border-white/10 p-3">
                <div className="space-y-2">
                  <Label htmlFor="phone-signup-name">Nombre completo</Label>
                  <Input id="phone-signup-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(limitProfileName(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone-signup-nickname">Apodo público (opcional)</Label>
                  <Input id="phone-signup-nickname" value={displayName} onChange={(event) => setDisplayName(limitProfileName(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone-signup-birth">Fecha de nacimiento (+18)</Label>
                  <Input id="phone-signup-birth" type="date" max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>País</Label>
                  <Select value={countryCode} onValueChange={setCountryCode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map(([code, name]) => <SelectItem key={code} value={code}>{countryFlag(code)} {name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {phoneSurveySkipped ? (
                  <Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={() => setPhoneSurveySkipped(false)}>Completar encuesta opcional</Button>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>¿Qué buscas?</Label>
                      <Select value={lookingFor} onValueChange={setLookingFor}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{LOOKING_FOR.map((item) => <SelectItem key={item.value} value={item.value}>{item.emoji} {item.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Signo zodiacal</Label>
                      <Select value={zodiac || "sin-especificar"} onValueChange={(value) => setZodiac(value === "sin-especificar" ? "" : value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo", "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"].map((sign) => <SelectItem key={sign} value={sign}>{sign}</SelectItem>)}<SelectItem value="sin-especificar">Prefiero omitirlo</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smokes} onChange={(event) => setSmokes(event.target.checked)} /> ¿Fumas?</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={drinks} onChange={(event) => setDrinks(event.target.checked)} /> ¿Tomas alcohol?</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasKids} onChange={(event) => setHasKids(event.target.checked)} /> ¿Tienes hijos?</label>
                    <div className="space-y-2"><Label htmlFor="phone-signup-hobbies">Pasatiempos favoritos</Label><Input id="phone-signup-hobbies" maxLength={240} value={hobbies} onChange={(event) => setHobbies(event.target.value)} /></div>
                    <Button type="button" variant="outline" className="w-full" onClick={() => setPhoneSurveySkipped(true)}>Omitir encuesta</Button>
                  </>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="phone-password">Contrasena</Label>
              <Input id="phone-password" type="password" autoComplete={phoneSignup ? "new-password" : "current-password"} value={phonePassword} onChange={(event) => setPhonePassword(event.target.value)} className="h-11 rounded-xl bg-surface/80" minLength={8} />
            </div>
            <p className="text-xs text-muted-foreground">Usa el telefono como usuario; no enviamos codigos SMS.</p>
            <Button
              type="button"
              className="h-12 w-full rounded-xl"
              disabled={busy}
              onClick={() => void continueWithPhonePassword()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {phoneSignup ? "Crear cuenta con telefono" : "Entrar con telefono"}
            </Button>

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
          El invitado puede probar una sola vez. Al continuar aceptas nuestras condiciones de uso.
        </p>
        <LegalLinks className="mt-3" />
      </div>
    </div>
  );
}
