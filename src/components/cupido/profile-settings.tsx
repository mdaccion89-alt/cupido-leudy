import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Crown, Link2, LogOut, Moon, ShieldCheck, Sun, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { getSavedAccounts, switchSavedAccount, useAuth } from "@/lib/auth-context";
import { updateCupidoSoundPreference } from "@/lib/cupido-sounds";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ProfileSettingsProps = { email?: string | null | undefined; phone?: string | null | undefined };
type Preferences = { theme_mode: "dark" | "light"; notifications_enabled: boolean; sound_enabled: boolean };

export function ProfileSettings({ email, phone }: ProfileSettingsProps) {
  const account = useAccount();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const userId = session?.user.id ?? null;
  const [busy, setBusy] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState(getSavedAccounts);
  const preferences = useQuery({
    queryKey: ["cupido-preferences", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("theme_mode,notifications_enabled,sound_enabled")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return {
        theme_mode: data?.theme_mode === "light" ? "light" as const : "dark" as const,
        notifications_enabled: data?.notifications_enabled !== false,
        sound_enabled: data?.sound_enabled !== false,
      };
    },
  });

  useEffect(() => {
    if (!preferences.data) return;
    localStorage.setItem("cupido-notifications", String(preferences.data.notifications_enabled));
    localStorage.setItem("cupido-sounds", String(preferences.data.sound_enabled));
    localStorage.setItem("cupido-dark", String(preferences.data.theme_mode === "dark"));
  }, [preferences.data]);

  useEffect(() => {
    setSavedAccounts(getSavedAccounts());
  }, [session?.user.id]);

  const savePreference = async (key: keyof Preferences, value: Preferences[keyof Preferences]) => {
    if (!userId) return;
    const previous = preferences.data;
    const next = { ...(previous ?? { theme_mode: "dark" as const, notifications_enabled: true, sound_enabled: true }), [key]: value } as Preferences;
    queryClient.setQueryData(["cupido-preferences", userId], next);
    if (key === "theme_mode") {
      const mode = value === "light" ? "light" : "dark";
      document.documentElement.dataset["theme"] = mode;
      document.documentElement.classList.toggle("dark", mode === "dark");
      localStorage.setItem("cupido-dark", String(mode === "dark"));
    }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ [key]: value } as never).eq("id", userId);
    setBusy(false);
    if (error) {
      queryClient.setQueryData(["cupido-preferences", userId], previous);
      if (previous?.theme_mode) {
        document.documentElement.dataset["theme"] = previous.theme_mode;
        document.documentElement.classList.toggle("dark", previous.theme_mode === "dark");
      }
      toast.error("No se pudo guardar este ajuste. Actualiza la migracion de Cupido y vuelve a intentar.");
      return;
    }
    localStorage.setItem(key === "theme_mode" ? "cupido-dark" : key === "notifications_enabled" ? "cupido-notifications" : "cupido-sounds", String(value));
    if (key === "sound_enabled") {
      updateCupidoSoundPreference(userId, value === true);
      void queryClient.invalidateQueries({ queryKey: ["cupido-sound-preference", userId] });
    }
  };

  const darkMode = preferences.data?.theme_mode !== "light";
  const notificationsOn = preferences.data?.notifications_enabled !== false;
  const soundsOn = preferences.data?.sound_enabled !== false;
  const leaveAccount = async (switchAccount: boolean) => {
    if (switchAccount) {
      setAccountPickerOpen(true);
      return;
    }
    setAccountPickerOpen(false);
    await supabase.removeAllChannels();
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error("No se pudo cerrar la sesión."); return; }
    queryClient.clear();
    await navigate({ to: "/auth", search: { ref: "" } });
  };

  const selectSavedAccount = async (savedUserId: string) => {
    setSwitchingAccount(true);
    queryClient.clear();
    try {
      await switchSavedAccount(savedUserId);
      setAccountPickerOpen(false);
      toast.success("Cambiaste de cuenta.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar de cuenta. Inicia sesión de nuevo.");
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <Crown className="size-4 text-amber-200" />
        <p className="text-sm font-medium text-white">Mi cuenta y ajustes</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3">
          <p className="text-[11px] text-amber-100/70">Monedas brillantes</p>
          <p className="font-display text-xl text-amber-200">{account.loading ? "..." : account.balanceUnavailable ? "—" : Number.isFinite(account.balance) ? account.balance.toLocaleString("es") : "∞"}</p>
        </div>
        <div className="rounded-xl border border-violet-300/20 bg-violet-400/[0.06] p-3">
          <p className="text-[11px] text-violet-100/70">Plan actual</p>
          <p className="font-display text-xl capitalize text-violet-200">{account.plan}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-2"><Link2 className="size-3.5" /> Correo vinculado: <span className="text-white">{email || "Google / Apple"}</span></p>
        <p className="flex items-center gap-2"><Link2 className="size-3.5" /> Teléfono: <span className="text-white">{phone || "No vinculado"}</span></p>
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        <label className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
          <span className="flex items-center gap-2"><Bell className="size-4" /> Notificaciones</span>
          <input type="checkbox" checked={notificationsOn} disabled={busy} onChange={(event) => void savePreference("notifications_enabled", event.target.checked)} />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
          <span className="flex items-center gap-2">{darkMode ? <Moon className="size-4" /> : <Sun className="size-4" />} Modo oscuro / modo claro</span>
          <input type="checkbox" checked={darkMode} disabled={busy} onChange={(event) => void savePreference("theme_mode", event.target.checked ? "dark" : "light")} />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
          <span className="flex items-center gap-2"><Volume2 className="size-4" /> Sonidos</span>
          <input type="checkbox" checked={soundsOn} disabled={busy} onChange={(event) => void savePreference("sound_enabled", event.target.checked)} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.dispatchEvent(new Event("cupido:show-support-widget"))}>
          <ShieldCheck className="size-4" /> Mostrar escudo de soporte
        </Button>
        <Button asChild variant="secondary"><Link to="/tienda">Hacerme Premium</Link></Button>
        <Button variant="outline" onClick={() => { queryClient.clear(); toast.success("Caché local borrada."); }}>
          <Trash2 className="size-4" /> Borrar caché
        </Button>
        <Button variant="destructive" onClick={() => void leaveAccount(false)}><LogOut className="size-4" /> Cerrar sesión</Button>
        <Button variant="outline" onClick={() => void leaveAccount(true)}><LogOut className="size-4" /> Cambiar de cuenta</Button>
      </div>
      <Dialog open={accountPickerOpen} onOpenChange={setAccountPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar de cuenta</DialogTitle>
            <DialogDescription>Elige una cuenta guardada en este dispositivo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {savedAccounts.filter((saved) => saved.user_id !== userId).map((saved) => (
              <Button key={saved.user_id} variant="outline" className="w-full justify-start" disabled={switchingAccount} onClick={() => void selectSavedAccount(saved.user_id)}>
                <span className="truncate">{saved.email || saved.user_id}</span>
              </Button>
            ))}
            {!savedAccounts.some((saved) => saved.user_id !== userId) && (
              <p className="rounded-lg border border-white/10 p-3 text-sm text-muted-foreground">Aún no hay otra cuenta guardada. Inicia sesión con otra cuenta y aparecerá aquí.</p>
            )}
            <Button variant="secondary" className="w-full" disabled={switchingAccount} onClick={() => void leaveAccount(false)}>
              <LogOut className="size-4" /> Iniciar sesión con otra cuenta
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
