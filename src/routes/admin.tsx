import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Save, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { CupidoAdminPanel } from "@/components/cupido/cupido-admin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { adminDeleteCupidoUser } from "@/lib/admin.functions";
import { SUPREME_ADMIN_EMAIL } from "@/lib/posts";
import { compressImageFile, safeExtension, uploadPublicImage } from "@/lib/storage";

const moderationDb = supabase as unknown as {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type AdminSettings = {
  site_title: string;
  site_tagline: string;
  banner_text: string;
  banner_image_url: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
  theme_preset: "cafe" | "dark" | "rosa" | "neon";
};

type AdminUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  full_name: string | null;
  plan: "free" | "pro" | "premium";
  balance: number;
  roles: string[];
  isOfficial: boolean;
  isVerified: boolean;
  followers: number;
  countryCode: string;
  languageCode: string;
  lastIp: string | null;
};

type AdminSnapshot = {
  settings: Partial<AdminSettings>;
  users: AdminUser[];
  stats: { userCount: number; credits: number; pendingWithdrawals: number };
  warnings: string[];
};

async function fetchAdminSnapshot(): Promise<AdminSnapshot> {
  const warnings: string[] = [];
  type ProfileRow = {
    id: string; email: string | null; display_name: string | null; full_name: string | null;
    plan: string | null; credits_balance: number | null; credits: number | null;
  };
  type CreatorRow = { id: string; is_official: boolean | null; is_verified_blue: boolean | null; follower_count: number | null };
  type LoginMetadataRow = { user_id: string; country_code: string | null; language_code: string | null; last_ip: string | null };
  const read = async <T,>(name: string, query: () => Promise<{ data: T | null; error: { message: string } | null }>, fallback: T) => {
    try {
      const result = await query();
      if (result.error) {
        warnings.push(name);
        console.warn(`[admin] No se pudo cargar ${name}.`, result.error.message);
        return fallback;
      }
      return result.data ?? fallback;
    } catch (error) {
      warnings.push(name);
      console.warn(`[admin] No se pudo cargar ${name}.`, error);
      return fallback;
    }
  };

  const [settings, profiles, credits, roles, creators, loginMetadata, userCount, pendingWithdrawals] = await Promise.all([
    read("la configuración", () => moderationDb.from("site_settings").select("*").eq("id", 1).maybeSingle(), null),
    read("los usuarios", () => moderationDb.from("profiles")
      .select("id,email,display_name,full_name,plan,plan_expires_at,created_at,credits,credits_balance")
      .order("created_at", { ascending: false }).limit(200), [] as ProfileRow[]),
    read("los saldos", () => moderationDb.from("user_credits").select("user_id,balance,daily_reset_at"), [] as Array<{ user_id: string; balance: number | null }>),
    read("los roles", () => moderationDb.from("user_roles").select("user_id,role"), [] as Array<{ user_id: string; role: string }>),
    read("los perfiles de creador", () => moderationDb.from("creator_profiles")
      .select("id,display_name,is_official,is_premium,is_verified_blue,follower_count"), [] as CreatorRow[]),
    read("los datos de inicio de sesión", () => moderationDb.from("cupido_login_metadata")
      .select("user_id,country_code,language_code,last_ip"), [] as LoginMetadataRow[]),
    read("el total de usuarios", async () => {
      const result = await moderationDb.from("profiles").select("id", { count: "exact", head: true });
      return { data: result.count ?? 0, error: result.error };
    }, 0),
    read("el total de retiros", async () => {
      const result = await moderationDb.from("cupido_withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending");
      return { data: result.count ?? 0, error: result.error };
    }, 0),
  ]);

  const creditByUser = new Map(credits.map((row) => [row.user_id, Number(row.balance ?? 0)]));
  const creatorByUser = new Map(creators.map((row) => [row.id, row]));
  const loginByUser = new Map(loginMetadata.map((row) => [row.user_id, row]));
  const rolesByUser = new Map<string, string[]>();
  for (const row of roles) rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);
  const users = profiles.map((profile): AdminUser => {
    const creator = creatorByUser.get(profile.id);
    const login = loginByUser.get(profile.id);
    return {
      ...profile,
      plan: profile.plan === "pro" || profile.plan === "premium" ? profile.plan : "free",
      balance: creditByUser.get(profile.id) ?? Number(profile.credits_balance ?? profile.credits ?? 0),
      roles: rolesByUser.get(profile.id) ?? [],
      isOfficial: Boolean(creator?.is_official),
      isVerified: Boolean(creator?.is_verified_blue),
      followers: Number(creator?.follower_count ?? 0),
      countryCode: login?.country_code ?? "",
      languageCode: login?.language_code ?? "",
      lastIp: login?.last_ip ?? null,
    };
  });

  return {
    settings: (settings ?? {}) as Partial<AdminSettings>,
    users,
    stats: {
      userCount: Number(userCount),
      credits: credits.reduce((sum, row) => sum + Number(row.balance ?? 0), 0) || users.reduce((sum, user) => sum + user.balance, 0),
      pendingWithdrawals: Number(pendingWithdrawals),
    },
    warnings,
  };
}

const EMPTY_ADMIN_SETTINGS: AdminSettings = {
  site_title: "Cupido Leudy",
  site_tagline: "Personas reales, conexiones reales",
  banner_text: "",
  banner_image_url: "",
  logo_url: "",
  primary_color: "",
  accent_color: "",
  theme_preset: "cafe",
};

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Panel Admin Supremo — Cupido Leudy ❤️" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { loading } = useAccount();
  const { session, loading: authLoading } = useAuth();
  const isAdmin = session?.user.email?.trim().toLowerCase() === SUPREME_ADMIN_EMAIL;
  if (loading || authLoading)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Cargando panel…
      </div>
    );
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <ShieldCheck className="mx-auto size-10 text-primary" />
          <h1 className="mt-4 text-xl font-semibold">Acceso restringido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Solo el Admin Supremo puede entrar aquí.
          </p>
        </div>
      </div>
    );
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const snapshot = useQuery({ queryKey: ["admin-snapshot"], queryFn: fetchAdminSnapshot });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const users = snapshot.data?.users ?? [];
  const selectedDeleteUser = users.find((user) => user.id === selectedUserId) ?? null;

  useEffect(() => {
    const channel = supabase
      .channel(`admin-users-live-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  const updateVerification = useMutation({
    mutationFn: async ({ userId, verified }: { userId: string; verified: boolean }) => {
      const { data, error } = await moderationDb.rpc("cupido_admin_set_user_verified", {
        _user_id: userId,
        _verified: verified,
      });
      if (error) throw error;
      if (data !== true) throw new Error("No se pudo actualizar la insignia.");
    },
    onMutate: async ({ userId, verified }) => {
      await queryClient.cancelQueries({ queryKey: ["admin-snapshot"] });
      const previousSnapshot = queryClient.getQueryData<AdminSnapshot>(["admin-snapshot"]);
      queryClient.setQueryData<AdminSnapshot>(["admin-snapshot"], (current) => current
        ? { ...current, users: current.users.map((user) => user.id === userId ? { ...user, isVerified: verified } : user) }
        : current);
      return { previousSnapshot };
    },
    onSuccess: (_result, variables) => {
      toast.success(variables.verified ? "Insignia azul activada." : "Insignia azul retirada.");
      void queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile", variables.userId] });
    },
    onError: (error, _variables, context) => {
      if (context?.previousSnapshot) {
        queryClient.setQueryData(["admin-snapshot"], context.previousSnapshot);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });
      }
      const details = error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Error desconocido de Supabase.";
      console.error("[admin] No se pudo actualizar la insignia.", error);
      toast.error(`No se pudo actualizar la insignia: ${details}`);
    },
  });
  const deleteAccount = useMutation({
    mutationFn: async (userId: string) => {
      const result = await adminDeleteCupidoUser({ data: { userId } });
      if (!result.ok) throw new Error("No se pudo eliminar la cuenta.");
    },
    onSuccess: () => {
      setSelectedUserId(null);
      toast.success("Cuenta eliminada completamente.");
      void queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });
    },
    onError: (error) => {
      console.error("[admin] No se pudo eliminar la cuenta.", error);
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la cuenta.");
    },
  });
  const [settings, setSettings] = useState<AdminSettings>(EMPTY_ADMIN_SETTINGS);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [creditDrafts, setCreditDrafts] = useState<Record<string, number>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, "free" | "pro" | "premium">>({});
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});

  const reports = useQuery({
    queryKey: ["cupido-admin", "reports"],
    queryFn: async () => {
      try {
        const { data, error } = await moderationDb
          .from("cupido_reports")
          .select("id,reason,reported_id,reporter_id,reported_comment_id,reported_post_id,status,created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      } catch (error) {
        console.warn("[admin] No se pudieron cargar los reportes.", error);
        return [];
      }
    },
  });

  const reviewReport = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "reviewed" | "dismissed" }) => {
      const { error } = await moderationDb
        .from("cupido_reports")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reporte actualizado.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-admin", "reports"] });
    },
    onError: () => toast.error("No se pudo actualizar el reporte."),
  });

  const supportTickets = useQuery({
    queryKey: ["cupido-admin", "support-tickets"],
    queryFn: async () => {
      try {
        const { data, error } = await moderationDb.from("cupido_support_tickets")
          .select("id,user_id,subject,message,status,admin_reply,created_at,updated_at")
          .in("status", ["open", "responded"])
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []) as Array<{ id: string; user_id: string; subject: string; message: string; status: string; admin_reply: string; created_at: string }>;
      } catch (error) {
        console.warn("[admin] No se pudieron cargar los tickets de soporte.", error);
        return [];
      }
    },
  });

  const replySupportTicket = useMutation({
    mutationFn: async (ticketId: string) => {
      const reply = ticketReplies[ticketId]?.trim() ?? "";
      const { error } = await moderationDb.rpc("cupido_reply_support_ticket", { _ticket: ticketId, _reply: reply });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Respuesta enviada al usuario.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-admin", "support-tickets"] });
      setTicketReplies({});
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar la respuesta."),
  });

  const removeReportedComment = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await moderationDb.rpc("cupido_admin_remove_reported_comment", { _report: reportId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Comentario eliminado y reporte atendido.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-admin", "reports"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo eliminar el comentario."),
  });

  const suspendReportedUser = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await moderationDb.rpc("cupido_admin_suspend_reported_user", { _report: reportId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cuenta suspendida de Cupido.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-admin", "reports"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo suspender la cuenta."),
  });

  useEffect(() => {
    if (snapshot.data) {
      setSettings({
        ...EMPTY_ADMIN_SETTINGS,
        ...snapshot.data.settings,
      });
    }
  }, [snapshot.data]);

  useEffect(() => {
    const channel = supabase
      .channel(("cupido-admin-inbox") + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_reports" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-admin", "reports"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_support_tickets" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-admin", "support-tickets"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });

  const mutate = (fn: Promise<unknown>, message: string) =>
    toast.promise(fn.then(invalidate), {
      loading: "Guardando…",
      success: message,
      error: "No se pudo guardar.",
    });

  const uploadSiteImage = async (
    field: "logo_url" | "banner_image_url",
    file: File | undefined,
  ) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona un archivo de imagen.");
      return;
    }
    setUploadingAsset(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error("Inicia sesión para subir la imagen.");
      const uploadFile = await compressImageFile(file);
      const extension = safeExtension(uploadFile.name, "jpg");
      const { url } = await uploadPublicImage(authData.user.id, uploadFile, "identity", extension);
      setSettings((current) => (current ? { ...current, [field]: url } : current));
      toast.success("Imagen subida correctamente.");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "No se pudo subir la imagen.",
      );
    } finally {
      setUploadingAsset(false);
    }
  };

  const saveSettings = useMutation({
    mutationFn: async (value: AdminSettings) => {
      const { error } = await moderationDb.from("site_settings").update({
        site_title: value.site_title,
        site_tagline: value.site_tagline,
        banner_text: value.banner_text,
        banner_image_url: value.banner_image_url,
        logo_url: value.logo_url,
        primary_color: value.primary_color,
        accent_color: value.accent_color,
        theme_preset: value.theme_preset,
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Identidad actualizada.");
    },
    onError: () => toast.error("No se pudo guardar la identidad."),
  });

  const saveThemePreset = useMutation({
    mutationFn: async (theme_preset: AdminSettings["theme_preset"]) => {
      const { error } = await moderationDb.from("site_settings").update({ theme_preset }).eq("id", 1);
      if (error) throw error;
      return theme_preset;
    },
    onSuccess: (theme_preset) => {
      setSettings((current) => ({ ...current, theme_preset }));
      void queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      toast.success("Tema principal actualizado.");
    },
    onError: () => toast.error("No se pudo guardar el tema."),
  });

  return (
    <main className="mx-auto w-full max-w-6xl overflow-x-hidden px-5 py-10 sm:px-8">
      <div className="mb-8 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold">Panel Admin Supremo</h1>
          <p className="text-sm text-muted-foreground">
            Verificación azul, regalos, retiros, PayPal y configuración general en Supabase real.
          </p>
        </div>
      </div>
      {(snapshot.isLoading || snapshot.error || (snapshot.data?.warnings.length ?? 0) > 0) && (
        <p className="mb-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100/80" role="status">
          {snapshot.isLoading ? "Cargando estadísticas y usuarios… La configuración PayPal está disponible." : "Algunos datos no están disponibles; puedes seguir usando el panel."}
        </p>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Estadísticas del panel">
        <AdminStat label="Usuarios" value={snapshot.data?.stats.userCount ?? users.length} />
        <AdminStat label="Monedas en circulación" value={(snapshot.data?.stats.credits ?? 0).toLocaleString("es")} />
        <AdminStat label="Retiros pendientes" value={snapshot.data?.stats.pendingWithdrawals ?? 0} />
      </section>

      <Tabs defaultValue="cupido">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          <TabsTrigger value="cupido">Cupido</TabsTrigger>
          <TabsTrigger value="identidad">Identidad</TabsTrigger>
          <TabsTrigger value="usuarios">Usuarios</TabsTrigger>
          <TabsTrigger value="revisiones">Revisiones</TabsTrigger>
        </TabsList>

        <TabsContent value="cupido" className="mt-6">
          <CupidoAdminPanel />
        </TabsContent>

        <TabsContent value="identidad" className="mt-6">
          <section className="panel grain space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tema principal de la app">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["cafe", "Blanco limpio · Cafe"],
                    ["dark", "Oscuro elegante"],
                    ["rosa", "Rosa Cupido"],
                    ["neon", "Morado Neón"],
                  ] as const).map(([value, label]) => (
                    <Button key={value} type="button" variant={settings.theme_preset === value ? "hero" : "outline"} disabled={saveThemePreset.isPending} onClick={() => saveThemePreset.mutate(value)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field label="Título del sitio">
                <Input
                  value={settings.site_title}
                  onChange={(e) => setSettings({ ...settings, site_title: e.target.value })}
                />
              </Field>
              <Field label="Eslogan">
                <Input
                  value={settings.site_tagline}
                  onChange={(e) => setSettings({ ...settings, site_tagline: e.target.value })}
                />
              </Field>
              <Field label="Logo Oficial de la App">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="glass"
                    disabled={uploadingAsset}
                    onClick={() => logoInput.current?.click()}
                  >
                    <Upload /> Subir logo
                  </Button>
                  <input
                    ref={logoInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadSiteImage("logo_url", e.target.files?.[0])}
                  />
                </div>
                {settings.logo_url && (
                  <img
                    src={settings.logo_url}
                    alt="Logo del sitio"
                    className="mt-2 h-12 w-auto max-w-full rounded-md object-contain"
                  />
                )}
              </Field>
              <Field label="Banner">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="glass"
                    disabled={uploadingAsset}
                    onClick={() => bannerInput.current?.click()}
                  >
                    <Upload /> Subir banner
                  </Button>
                  <input
                    ref={bannerInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadSiteImage("banner_image_url", e.target.files?.[0])}
                  />
                </div>
                {settings.banner_image_url && (
                  <img
                    src={settings.banner_image_url}
                    alt="Banner del sitio"
                    className="mt-2 h-16 w-full rounded-md object-cover"
                  />
                )}
              </Field>
              <Field label="Color primario">
                <Input
                  type="color"
                  value={settings.primary_color || "#7c3aed"}
                  onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                  className="h-10 w-full cursor-pointer"
                />
              </Field>
              <Field label="Color de acento">
                <Input
                  type="color"
                  value={settings.accent_color || "#22d3ee"}
                  onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })}
                  className="h-10 w-full cursor-pointer"
                />
              </Field>
            </div>
            <Field label="Texto del banner">
              <Textarea
                value={settings.banner_text}
                onChange={(e) => setSettings({ ...settings, banner_text: e.target.value })}
              />
            </Field>
            <Button
              variant="hero"
              disabled={saveSettings.isPending}
              onClick={() => saveSettings.mutate(settings)}
            >
              {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />} Guardar
              identidad
            </Button>
          </section>
        </TabsContent>

        <TabsContent value="usuarios" className="mt-6">
          <section className="panel grain w-full max-w-full min-w-0 overflow-x-hidden p-4 sm:p-6">
            <h2 className="mb-4 font-semibold">Usuarios ({users.length})</h2>
            <div className="mb-4 space-y-3 md:hidden">
              {users.map((user) => (
                <article
                  key={user.id}
                  data-delete-selected={selectedUserId === user.id}
                  className="flex w-full max-w-full min-w-0 flex-col gap-3 overflow-x-hidden rounded-2xl border border-border/70 bg-card p-4 data-[delete-selected=true]:ring-2 data-[delete-selected=true]:ring-destructive"
                >
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-foreground">{user.display_name || user.email || "Artista"}</p>
                    <p className="break-all text-xs text-muted-foreground">{user.email || "Sin correo"}</p>
                    <p className="mt-1 break-words text-[10px] text-muted-foreground">IP: {user.lastIp || "—"} · {user.countryCode || "País no detectado"} · {user.languageCode || "idioma no detectado"}</p>
                    {user.isOfficial && <Badge className="mt-2">Oficial</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-secondary px-2.5 py-1">{user.balance.toLocaleString("es")} monedas</span>
                    <span className="rounded-full bg-secondary px-2.5 py-1">Plan {user.plan}</span>
                    {user.roles.map((role) => <Badge key={role} variant="secondary">{role}</Badge>)}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button className="w-full" variant={user.isVerified ? "destructive" : "outline"} disabled={updateVerification.isPending} onClick={() => updateVerification.mutate({ userId: user.id, verified: !user.isVerified })}>
                      {user.isVerified ? "Quitar insignia azul" : "Dar insignia azul"}
                    </Button>
                    <Button className="w-full" variant="destructive" disabled={deleteAccount.isPending || user.id === session?.user.id} onClick={() => setSelectedUserId(user.id)}>
                      <Trash2 className="size-4" /> Eliminar cuenta
                    </Button>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                      type="number"
                      aria-label={`Monedas para ${user.display_name || user.email || "usuario"}`}
                      className="h-10 min-w-0 flex-1"
                      value={creditDrafts[user.id] ?? 1}
                      onChange={(event) => setCreditDrafts({ ...creditDrafts, [user.id]: Number(event.target.value) })}
                    />
                    <Button className="w-full sm:w-auto" variant="glass" onClick={() => void mutate(
                      moderationDb.rpc("admin_adjust_credits", {
                        _user_id: user.id,
                        _delta: creditDrafts[user.id] ?? 1,
                      }).then(({ error }) => { if (error) throw error; }),
                      "Créditos ajustados.",
                    )}>
                      Ajustar monedas
                    </Button>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <select
                      aria-label={`Plan para ${user.display_name || user.email || "usuario"}`}
                      className="h-10 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-sm"
                      value={planDrafts[user.id] ?? user.plan}
                      onChange={(event) => setPlanDrafts({ ...planDrafts, [user.id]: event.target.value as "free" | "pro" | "premium" })}
                    >
                      <option value="free">free</option>
                      <option value="pro">pro</option>
                      <option value="premium">premium</option>
                    </select>
                    <Button className="w-full sm:w-auto" variant="glass" onClick={() => void mutate(
                      moderationDb.rpc("admin_set_plan", {
                        _user_id: user.id,
                        _plan: planDrafts[user.id] ?? user.plan,
                        _days: 30,
                      }).then(({ error }) => { if (error) throw error; }),
                      "Plan actualizado.",
                    )}>
                      Actualizar plan
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2">Usuario</th>
                  <th>Créditos</th>
                  <th>Plan</th>
                  <th>Roles</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-border/60">
                    <td className="py-3">
                      <div className="font-medium">
                        {user.display_name || user.email || "Artista"}
                      </div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                      <div className="text-[10px] text-muted-foreground">IP: {user.lastIp || "—"} · {user.countryCode || "País no detectado"} · {user.languageCode || "idioma no detectado"}</div>
                      {user.isOfficial && <Badge className="mt-1">Oficial</Badge>}
                    </td>
                    <td>{user.balance}</td>
                    <td>{user.plan}</td>
                    <td className="flex flex-wrap gap-1 pt-3">
                      {user.roles.map((role) => (
                        <Badge key={role} variant="secondary">
                          {role}
                        </Badge>
                      ))}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant={user.isVerified ? "destructive" : "outline"} disabled={updateVerification.isPending} onClick={() => updateVerification.mutate({ userId: user.id, verified: !user.isVerified })}>
                          {user.isVerified ? "Quitar insignia azul" : "Dar insignia azul"}
                        </Button>
                        <Button size="sm" variant="destructive" disabled={deleteAccount.isPending || user.id === session?.user.id} onClick={() => setSelectedUserId(user.id)}>
                          <Trash2 className="size-4" /> Eliminar cuenta
                        </Button>
                        <Input
                          type="number"
                          className="h-9 w-20"
                          value={creditDrafts[user.id] ?? 1}
                          onChange={(e) =>
                            setCreditDrafts({ ...creditDrafts, [user.id]: Number(e.target.value) })
                          }
                        />
                        <Button
                          size="sm"
                          variant="glass"
                          onClick={() =>
                            mutate(
                              moderationDb.rpc("admin_adjust_credits", {
                                _user_id: user.id,
                                _delta: creditDrafts[user.id] ?? 1,
                              }).then(({ error }) => { if (error) throw error; }),
                              "Créditos ajustados.",
                            )
                          }
                        >
                          +/−
                        </Button>
                        <select
                          className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                          value={planDrafts[user.id] ?? user.plan}
                          onChange={(e) =>
                            setPlanDrafts({
                              ...planDrafts,
                              [user.id]: e.target.value as "free" | "pro" | "premium",
                            })
                          }
                        >
                          <option value="free">free</option>
                          <option value="pro">pro</option>
                          <option value="premium">premium</option>
                        </select>
                        <Button
                          size="sm"
                          variant="glass"
                          onClick={() =>
                            mutate(
                              moderationDb.rpc("admin_set_plan", {
                                _user_id: user.id,
                                _plan: planDrafts[user.id] ?? user.plan,
                                _days: 30,
                              }).then(({ error }) => { if (error) throw error; }),
                              "Plan actualizado.",
                            )
                          }
                        >
                          Plan
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              El rol de Admin Supremo y la insignia oficial se sincronizan desde Supabase para
              leudyfeliz81@gmail.com.
            </p>
          </section>
        </TabsContent>

        <TabsContent value="revisiones" className="mt-6">
          <section className="panel grain p-6">
            <h2 className="mb-4 font-semibold">Reportes de la comunidad</h2>
            <div className="space-y-3">
              {reports.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">No hay reportes pendientes.</p>
              )}
              {(reports.data ?? []).map((report: { id: string; reason: string; reporter_id: string; reported_id: string; reported_comment_id: string | null; created_at: string }) => (
                <div
                  key={report.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-4"
                >
                  <div>
                    <p className="font-medium">{report.reason || "Reporte sin motivo"}</p>
                    <p className="text-xs text-muted-foreground">
                      {`${report.reporter_id.slice(0, 8)} → ${report.reported_id.slice(0, 8)} · ${new Date(report.created_at).toLocaleString("es")}`}
                    </p>
                    {report.reported_comment_id && <p className="mt-1 text-xs text-pink-200">Comentario {report.reported_comment_id.slice(0, 8)}</p>}
                  </div>
                  <div className="flex gap-2">
                    {report.reported_comment_id && (
                      <Button size="sm" variant="destructive" disabled={removeReportedComment.isPending} onClick={() => removeReportedComment.mutate(report.id)}>
                        Eliminar comentario
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={suspendReportedUser.isPending} onClick={() => suspendReportedUser.mutate(report.id)}>
                      Suspender cuenta
                    </Button>
                    <Button
                      size="sm"
                      variant="hero"
                      disabled={reviewReport.isPending}
                      onClick={() => reviewReport.mutate({ id: report.id, status: "reviewed" })}
                    >
                      <Check /> Revisado
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={reviewReport.isPending}
                      onClick={() => reviewReport.mutate({ id: report.id, status: "dismissed" })}
                    >
                      <X /> Descartar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="panel grain mt-6 p-6">
            <h2 className="mb-4 font-semibold">Tickets de soporte</h2>
            <div className="space-y-4">
              {supportTickets.data?.length === 0 && <p className="text-sm text-muted-foreground">No hay tickets pendientes.</p>}
              {(supportTickets.data ?? []).map((ticket) => (
                <article key={ticket.id} className="space-y-3 rounded-xl border border-border/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{ticket.subject}</h3>
                    <Badge variant={ticket.status === "responded" ? "secondary" : "default"}>{ticket.status === "responded" ? "Respondido" : "Abierto"}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground/80">{ticket.message}</p>
                  <p className="text-xs text-muted-foreground">Usuario {ticket.user_id.slice(0, 8)} · {new Date(ticket.created_at).toLocaleString("es")}</p>
                  {ticket.admin_reply && <p className="rounded-lg bg-white/[0.04] p-3 text-sm text-pink-100">Última respuesta: {ticket.admin_reply}</p>}
                  <Textarea value={ticketReplies[ticket.id] ?? ""} maxLength={4000} onChange={(event) => setTicketReplies((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Escribe la respuesta para el usuario…" />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={replySupportTicket.isPending || !(ticketReplies[ticket.id] ?? "").trim()} onClick={() => replySupportTicket.mutate(ticket.id)}>
                      Enviar respuesta
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </TabsContent>

      </Tabs>
      <AlertDialog
        open={selectedUserId !== null}
        onOpenChange={(open) => {
          if (!open && !deleteAccount.isPending) setSelectedUserId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar eliminación de cuenta</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedDeleteUser
                ? `Vas a eliminar la cuenta de ${selectedDeleteUser.display_name || selectedDeleteUser.full_name || "este usuario"} (${selectedDeleteUser.email || "sin correo"}). Esta acción no se puede deshacer.`
                : "No se encontró la cuenta seleccionada. Cierra esta ventana y vuelve a intentarlo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccount.isPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteAccount.isPending || !selectedDeleteUser}
              onClick={() => {
                if (selectedDeleteUser && selectedUserId === selectedDeleteUser.id) {
                  deleteAccount.mutate(selectedDeleteUser.id);
                }
              }}
            >
              {deleteAccount.isPending ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
              Eliminar esta cuenta
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AdminStat({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="panel grain px-5 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-white">{value}</p>
    </article>
  );
}
