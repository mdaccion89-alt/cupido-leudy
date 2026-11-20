import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Save, ShieldCheck, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { CupidoAdminPanel } from "@/components/cupido/cupido-admin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import {
  adminAdjustCredits,
  adminSetPlan,
  getAdminSnapshot,
  saveAdminSettings,
  uploadSiteAsset,
  type AdminSettings,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Panel Admin Supremo — Cupido Leudy ❤️" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading } = useAccount();
  if (loading)
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
  const queryClient = useQueryClient();
  const getSnapshot = useServerFn(getAdminSnapshot);
  const saveSettingsFn = useServerFn(saveAdminSettings);
  const uploadAssetFn = useServerFn(uploadSiteAsset);
  const adjustCreditsFn = useServerFn(adminAdjustCredits);
  const setPlanFn = useServerFn(adminSetPlan);
  const snapshot = useQuery({ queryKey: ["admin-snapshot"], queryFn: () => getSnapshot() });
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [creditDrafts, setCreditDrafts] = useState<Record<string, number>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, "free" | "pro" | "premium">>({});

  const reports = useQuery({
    queryKey: ["cupido-admin", "reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_reports")
        .select("id,reason,reported_id,reporter_id,status,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const reviewReport = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "reviewed" | "dismissed" }) => {
      const { error } = await supabase
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

  useEffect(() => {
    if (snapshot.data?.settings?.site_title) {
      setSettings({
        site_title: snapshot.data.settings.site_title ?? "",
        site_tagline: snapshot.data.settings.site_tagline ?? "",
        banner_text: snapshot.data.settings.banner_text ?? "",
        banner_image_url: snapshot.data.settings.banner_image_url ?? "",
        logo_url: snapshot.data.settings.logo_url ?? "",
        primary_color: snapshot.data.settings.primary_color ?? "",
        accent_color: snapshot.data.settings.accent_color ?? "",
      });
    }
  }, [snapshot.data]);

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
      const base64 = await readFileAsBase64(file);
      const extension =
        file.name
          .split(".")
          .pop()
          ?.toLowerCase()
          .replace(/[^a-z0-9]/g, "") || "png";
      const kind = field === "logo_url" ? "logo" : "banner";
      const result = await uploadAssetFn({
        data: {
          path: `identity/${kind}-${Date.now()}.${extension}`,
          contentType: file.type,
          base64,
        },
      });
      setSettings((current) => (current ? { ...current, [field]: result.url } : current));
      toast.success("Imagen subida al bucket site.");
    } catch {
      toast.error("No se pudo subir la imagen.");
    } finally {
      setUploadingAsset(false);
    }
  };

  const saveSettings = useMutation({
    mutationFn: (value: AdminSettings) => saveSettingsFn({ data: { settings: value } }),
    onSuccess: () => {
      invalidate();
      toast.success("Identidad actualizada.");
    },
    onError: () => toast.error("No se pudo guardar la identidad."),
  });

  if (snapshot.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Cargando datos…
      </div>
    );
  if (snapshot.error || !snapshot.data || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5 text-destructive">
        No se pudo cargar el panel.
      </div>
    );
  }

  const users = snapshot.data.users;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
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
              <Field label="Logo">
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
          <section className="panel grain overflow-x-auto p-6">
            <h2 className="mb-4 font-semibold">Usuarios ({users.length})</h2>
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
                              adjustCreditsFn({
                                data: { userId: user.id, delta: creditDrafts[user.id] ?? 1 },
                              }),
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
                              setPlanFn({
                                data: {
                                  userId: user.id,
                                  plan:
                                    planDrafts[user.id] ??
                                    (user.plan as "free" | "pro" | "premium"),
                                  days: 30,
                                },
                              }),
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
              {(reports.data ?? []).map((report) => (
                <div
                  key={report.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-4"
                >
                  <div>
                    <p className="font-medium">{report.reason || "Reporte sin motivo"}</p>
                    <p className="text-xs text-muted-foreground">
                      {`${report.reporter_id.slice(0, 8)} → ${report.reported_id.slice(0, 8)} · ${new Date(report.created_at).toLocaleString("es")}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
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
        </TabsContent>

      </Tabs>
    </main>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
