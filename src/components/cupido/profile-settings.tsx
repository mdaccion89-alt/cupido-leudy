import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Crown, Link2, LogOut, Moon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";

type ProfileSettingsProps = { email?: string | null | undefined; phone?: string | null | undefined };

export function ProfileSettings({ email, phone }: ProfileSettingsProps) {
  const account = useAccount();
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [sounds, setSounds] = useState(true);

  useEffect(() => {
    setNotifications(localStorage.getItem("cupido-notifications") !== "false");
    setDarkMode(localStorage.getItem("cupido-dark") !== "false");
    setSounds(localStorage.getItem("cupido-sounds") !== "false");
  }, []);

  const persist = (key: string, value: boolean) => localStorage.setItem(key, String(value));

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <Crown className="size-4 text-amber-200" />
        <p className="text-sm font-medium text-white">Mi cuenta y ajustes</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3">
          <p className="text-[11px] text-amber-100/70">Monedas brillantes</p>
          <p className="font-display text-xl text-amber-200">
            {Number.isFinite(account.balance) ? account.balance.toLocaleString("es") : "∞"}
          </p>
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
          <input
            type="checkbox"
            checked={notifications}
            onChange={(event) => {
              setNotifications(event.target.checked);
              persist("cupido-notifications", event.target.checked);
            }}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
          <span className="flex items-center gap-2"><Moon className="size-4" /> Modo oscuro Café</span>
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(event) => {
              setDarkMode(event.target.checked);
              persist("cupido-dark", event.target.checked);
              document.documentElement.dataset["theme"] = event.target.checked ? "dark" : "light";
            }}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
          <span className="flex items-center gap-2"><Bell className="size-4" /> Sonidos</span>
          <input
            type="checkbox"
            checked={sounds}
            onChange={(event) => {
              setSounds(event.target.checked);
              persist("cupido-sounds", event.target.checked);
            }}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link to="/tienda">Hacerme Premium</Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            queryClient.clear();
            toast.success("Caché local borrada.");
          }}
        >
          <Trash2 className="size-4" /> Borrar caché
        </Button>
        <Button variant="destructive" onClick={() => void supabase.auth.signOut()}>
          <LogOut className="size-4" /> Cerrar sesión
        </Button>
      </div>
    </section>
  );
}
