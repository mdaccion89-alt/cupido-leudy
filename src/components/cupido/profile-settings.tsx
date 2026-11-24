import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Crown, Link2, LogOut, Moon, ShieldCheck, Sun, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { forgetSavedAccount, getSavedAccounts, switchSavedAccount, useAuth } from "@/lib/auth-context";
import { updateCupidoSoundPreference } from "@/lib/cupido-sounds";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { deleteOwnCupidoAccount } from "@/lib/admin.functions";

type ProfileSettingsProps = { email?: string | null | undefined; phone?: string | null | undefined };
type Preferences = { theme_mode: "dark" | "light"; notifications_enabled: boolean; sound_enabled: boolean };

export function ProfileSettings({ email, phone }: ProfileSettingsProps) {
  const account = useAccount();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleteAccountServer = useServerFn(deleteOwnCupidoAccount);
  const userId = session?.user.id ?? null;
  const [busy, setBusy] = useState(false);
  const [deleteIntroOpen, setDeleteIntroOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
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

  const permanentlyDeleteAccount = async () => {
    if (!userId || deleteConfirmation !== "ELIMINAR") return;
    setDeletingAccount(true);
    try {
      await deleteAccountServer();
      forgetSavedAccount(userId);
      await supabase.removeAllChannels();
      queryClient.clear();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) console.warn("[account] La cuenta se eliminó, pero no se pudo limpiar la sesión local.", error.message);
      setDeleteConfirmOpen(false);
      toast.success("Tu cuenta y los datos asociados fueron eliminados.");
      await navigate({ to: "/eliminar-cuenta" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingAccount(false);
      setDeleteConfirmation("");
    }
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
        <Button variant="outline" onClick={() => void leaveAccount(true)}><LogOut className="size-4" /> Cambiar de cuenta</Button>
      </div>
      <div className="mt-5 rounded-xl border border-rose-400/25 bg-rose-950/20 p-3">
        <p className="text-sm font-semibold text-rose-100">Zona de cuenta</p>
        <p className="mt-1 text-xs leading-relaxed text-rose-100/70">Puedes eliminar permanentemente tu cuenta y el contenido y datos asociados.</p>
        <Button variant="destructive" className="mt-3 min-h-11 w-full whitespace-normal text-center sm:w-auto" onClick={() => setDeleteIntroOpen(true)}>
          <Trash2 className="size-4 shrink-0" /> Eliminar mi cuenta y datos
        </Button>
      </div>
      <AlertDialog open={deleteIntroOpen} onOpenChange={setDeleteIntroOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tu cuenta?</AlertDialogTitle>
            <AlertDialogDescription>Se borrarán tu perfil, publicaciones, historias, mensajes, archivos subidos y datos asociados. Esta acción es permanente y cerrará tu sesión.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conservar cuenta</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" onClick={(event) => { event.preventDefault(); setDeleteIntroOpen(false); setDeleteConfirmOpen(true); }}>Continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => { setDeleteConfirmOpen(open); if (!open) setDeleteConfirmation(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirma la eliminación permanente</AlertDialogTitle>
            <AlertDialogDescription>Para confirmar por segunda vez, escribe <strong>ELIMINAR</strong>. No podrás recuperar tu cuenta ni sus datos.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value.trim().toUpperCase())} placeholder="Escribe ELIMINAR" aria-label="Escribe ELIMINAR para confirmar" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAccount}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={deletingAccount || deleteConfirmation !== "ELIMINAR"} onClick={() => void permanentlyDeleteAccount()}>
              {deletingAccount ? "Eliminando cuenta…" : "Eliminar cuenta y datos"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
