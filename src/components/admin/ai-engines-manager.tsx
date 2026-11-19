import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAiEngines,
  saveAiEngine,
  saveAiEngineRoutes,
  testAiEngine,
  type AiEngineSnapshot,
  type AiGatewayRoute,
} from "@/lib/ai-engine.functions";
import {
  AI_FUNCTION_KEYS,
  defaultModelFor,
  enginesForFunction,
  getAiEngine,
  isAiEngineKey,
  type AiFunctionKey,
} from "@/lib/ai-engine-catalog";

const FUNCTION_LABELS: Record<AiFunctionKey, string> = {
  text: "Texto",
  image: "Imagen",
  transcription: "Transcripción",
};

function statusLabel(status: string): string {
  if (status === "ok") return "Conectado";
  if (status === "error") return "Error";
  return "Sin configurar";
}

function formatDate(value: string | null): string {
  if (!value) return "Nunca";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Nunca" : date.toLocaleString();
}

export function AiEnginesManager() {
  const queryClient = useQueryClient();
  const getSnapshot = useServerFn(getAiEngines);
  const testEngine = useServerFn(testAiEngine);
  const saveEngine = useServerFn(saveAiEngine);
  const saveRoutes = useServerFn(saveAiEngineRoutes);
  const snapshot = useQuery({ queryKey: ["ai-engines"], queryFn: () => getSnapshot() });

  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [paidPhrases, setPaidPhrases] = useState<Record<string, string>>({});
  const [routeDrafts, setRouteDrafts] = useState<AiGatewayRoute[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [routesSaving, setRoutesSaving] = useState(false);

  const saveRoutesMutation = useMutation({
    mutationFn: (routes: AiGatewayRoute[]) => saveRoutes({ data: { routes } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error ?? "No se pudieron guardar las rutas.");
        return;
      }
      toast.success("Rutas y fallback actualizados.");
      void queryClient.invalidateQueries({ queryKey: ["ai-engines"] });
    },
    onError: () => toast.error("No se pudieron guardar las rutas."),
  });

  useEffect(() => {
    const data = snapshot.data as AiEngineSnapshot | null | undefined;
    if (!data) return;
    setModelDrafts(
      Object.fromEntries(data.engines.map((engine) => [engine.key, engine.model])),
    );
    setRouteDrafts(data.routes);
  }, [snapshot.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ai-engines"] });

  const handleTest = async (key: string) => {
    setTesting(key);
    try {
      const result = await testEngine({
        data: { providerKey: key, model: modelDrafts[key] },
      });
      if (result.ok) toast.success(result.detail ?? "Conexión verificada.");
      else toast.error(result.error ?? "La prueba de conexión falló.");
      await invalidate();
    } catch {
      toast.error("No se pudo ejecutar la prueba de conexión.");
    } finally {
      setTesting(null);
    }
  };

  const handleSave = async (key: string, enabled: boolean) => {
    const engine = snapshot.data?.engines.find((item) => item.key === key);
    if (
      engine?.paidAuthorizationRequired &&
      enabled &&
      !engine.paidAuthorizedAt &&
      paidPhrases[key] !== "AUTORIZO COBROS"
    ) {
      toast.error("Escribe AUTORIZO COBROS para activar este motor con posible facturación.");
      return;
    }
    setSaving(key);
    try {
      const result = await saveEngine({
        data: {
          providerKey: key,
          model: modelDrafts[key],
          enabled,
          paidAuthorizationPhrase: paidPhrases[key],
        },
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar el motor.");
        return;
      }
      toast.success(enabled ? "Motor activado." : "Motor desactivado.");
      setPaidPhrases((current) => ({ ...current, [key]: "" }));
      await invalidate();
    } catch {
      toast.error("No se pudo guardar el motor.");
    } finally {
      setSaving(null);
    }
  };

  const updateRoute = (
    functionKey: AiFunctionKey,
    providerKey: string,
    patch: Partial<AiGatewayRoute>,
  ) => {
    setRouteDrafts((current) =>
      current.map((route) =>
        route.function_key === functionKey && route.provider_key === providerKey
          ? { ...route, ...patch }
          : route,
      ),
    );
  };

  const addRoute = (functionKey: AiFunctionKey) => {
    const available = enginesForFunction(functionKey).find(
      (engine) =>
        !routeDrafts.some(
          (route) =>
            route.function_key === functionKey && route.provider_key === engine.key,
        ),
    );
    if (!available) {
      toast.message("Todos los motores compatibles ya están en esta función.");
      return;
    }
    setRouteDrafts((current) => [
      ...current,
      {
        function_key: functionKey,
        provider_key: available.key,
        model: defaultModelFor(available.key, functionKey),
        priority: current.filter((route) => route.function_key === functionKey).length + 1,
        enabled: true,
      },
    ]);
  };

  if (snapshot.isLoading)
    return (
      <section className="panel grain p-6 text-sm text-muted-foreground">
        Cargando motores IA…
      </section>
    );

  if (snapshot.error || !snapshot.data)
    return (
      <section className="panel grain p-6 text-sm text-destructive">
        No se pudo cargar el estado de los motores IA. Verifica la Edge Function `ai-gateway`.
      </section>
    );

  const data = snapshot.data;

  return (
    <div className="space-y-6">
      <section className="panel grain space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Motores IA conectados</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Estado real, cuotas, pruebas de conexión y activación segura de proveedores. Las claves
              nunca se envían al navegador.
            </p>
          </div>
          <Button variant="glass" size="sm" onClick={() => void invalidate()}>
            <RefreshCw /> Actualizar
          </Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-surface-raised/50 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Secretos de la Edge Function</p>
          <p className="mt-1">
            Configura los secretos en Supabase, no en esta pantalla:{" "}
            <code>GEMINI_API_KEY</code>, <code>CLOUDFLARE_API_TOKEN</code>,{" "}
            <code>CLOUDFLARE_ACCOUNT_ID</code>, <code>OLLAMA_BASE_URL</code>,{" "}
            <code>GROQ_API_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </p>
          <p className="mt-1">
            Service role: {data.gateway.serviceRoleConfigured ? "configurado" : "pendiente"}.
            Solo se muestran banderas de configuración, nunca los valores.
          </p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.engines.map((engine) => {
          const busy = testing === engine.key || saving === engine.key;
          return (
            <section key={engine.key} className="panel grain space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{engine.label}</h3>
                  <p className="text-xs text-muted-foreground">{engine.vendor}</p>
                </div>
                <Badge
                  variant={
                    engine.status === "ok"
                      ? "default"
                      : engine.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {statusLabel(engine.status)}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground">{engine.description}</p>

              <div className="flex flex-wrap gap-1.5">
                {engine.capabilities.map((capability) => (
                  <Badge key={capability} variant="outline">
                    {FUNCTION_LABELS[capability]}
                  </Badge>
                ))}
                <Badge variant="outline">{engine.billing}</Badge>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Modelo por defecto: <code>{engine.model}</code>
                </p>
                <p>
                  Última comprobación: {formatDate(engine.lastCheckedAt)} ·{" "}
                  {engine.lastLatencyMs === null ? "sin latencia" : `${engine.lastLatencyMs} ms`}
                </p>
                <p>Cuota: {engine.quota}</p>
                {Object.entries(engine.quotaSnapshot).slice(0, 3).map(([key, value]) => (
                  <p key={key}>
                    {key}: <code>{value}</code>
                  </p>
                ))}
              </div>

              {engine.statusDetail && (
                <p
                  className={`rounded-lg border p-3 text-xs ${
                    engine.status === "error"
                      ? "border-destructive/40 text-destructive"
                      : "border-border/60 text-muted-foreground"
                  }`}
                >
                  {engine.statusDetail}
                </p>
              )}

              <div className="space-y-1 text-xs text-muted-foreground">
                {engine.secrets.map((secret) => (
                  <div key={secret} className="flex items-center gap-2">
                    {engine.configured[secret] ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <X className="size-3.5 text-destructive" />
                    )}
                    <code>{secret}</code>
                    <span>{engine.configured[secret] ? "configurado" : "pendiente"}</span>
                  </div>
                ))}
              </div>

              {engine.notes && (
                <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {engine.notes}
                </p>
              )}

              <div className="space-y-2">
                <Label>Modelo</Label>
                {engine.customModel || engine.models.length > 1 ? (
                  <Input
                    value={modelDrafts[engine.key] ?? engine.model}
                    onChange={(event) =>
                      setModelDrafts({ ...modelDrafts, [engine.key]: event.target.value })
                    }
                  />
                ) : (
                  <select
                    className="h-10 w-full rounded-md border border-input bg-surface px-3 text-sm"
                    value={modelDrafts[engine.key] ?? engine.model}
                    onChange={(event) =>
                      setModelDrafts({ ...modelDrafts, [engine.key]: event.target.value })
                    }
                  >
                    {engine.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {engine.paidAuthorizationRequired && !engine.paidAuthorizedAt && (
                <div className="space-y-2">
                  <Label>Autorización de posible facturación</Label>
                  <Input
                    placeholder="AUTORIZO COBROS"
                    value={paidPhrases[engine.key] ?? ""}
                    onChange={(event) =>
                      setPaidPhrases({ ...paidPhrases, [engine.key]: event.target.value })
                    }
                  />
                </div>
              )}

              {engine.paidAuthorizedAt && (
                <p className="text-xs text-muted-foreground">
                  Autorizado el {formatDate(engine.paidAuthorizedAt)}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="glass"
                  size="sm"
                  disabled={busy || !engine.allConfigured}
                  onClick={() => void handleTest(engine.key)}
                >
                  {testing === engine.key ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Probar conexión
                </Button>
                <Button
                  variant={engine.enabled ? "outline" : "hero"}
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleSave(engine.key, !engine.enabled)}
                >
                  {saving === engine.key ? <Loader2 className="animate-spin" /> : null}
                  {engine.enabled ? "Desactivar" : "Activar"}
                </Button>
                <a
                  href={engine.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md px-2 text-xs text-primary hover:underline"
                >
                  Documentación <ExternalLink className="size-3" />
                </a>
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel grain space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Selector por función y fallback</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              El primer motor activo, probado y configurado responde; si falla, se intenta el
              siguiente.
            </p>
          </div>
          <Button
            variant="hero"
            size="sm"
            disabled={routesSaving || saveRoutesMutation.isPending}
            onClick={() => saveRoutesMutation.mutate(routeDrafts)}
          >
            {routesSaving || saveRoutesMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Save />
            )}
            Guardar rutas
          </Button>
        </div>

        <div className="space-y-5">
          {AI_FUNCTION_KEYS.map((functionKey) => {
            const routes = routeDrafts.filter((route) => route.function_key === functionKey);
            return (
              <div key={functionKey} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{FUNCTION_LABELS[functionKey]}</h3>
                  <Button variant="glass" size="sm" onClick={() => addRoute(functionKey)}>
                    <Plus /> Añadir motor
                  </Button>
                </div>
                {routes.map((route) => {
                  const engine = isAiEngineKey(route.provider_key)
                    ? getAiEngine(route.provider_key)
                    : null;
                  return (
                    <div
                      key={`${route.function_key}-${route.provider_key}`}
                      className="grid items-center gap-2 rounded-xl border border-border/60 p-3 sm:grid-cols-[1.2fr_1.5fr_0.5fr_0.5fr_auto]"
                    >
                      <span className="text-sm">{engine?.label ?? route.provider_key}</span>
                      <Input
                        className="h-9"
                        value={route.model}
                        onChange={(event) =>
                          updateRoute(functionKey, route.provider_key, {
                            model: event.target.value,
                          })
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        className="h-9"
                        value={route.priority}
                        onChange={(event) =>
                          updateRoute(functionKey, route.provider_key, {
                            priority: Number(event.target.value),
                          })
                        }
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={route.enabled}
                          onChange={(event) =>
                            updateRoute(functionKey, route.provider_key, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        Activa
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setRouteDrafts((current) =>
                            current.filter(
                              (item) =>
                                !(
                                  item.function_key === functionKey &&
                                  item.provider_key === route.provider_key
                                ),
                            ),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
                {routes.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin motores asignados.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel grain overflow-x-auto p-6">
        <h2 className="mb-4 text-lg font-semibold">Registro de actividad</h2>
        <table className="w-full min-w-[780px] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2">Fecha</th>
              <th>Función</th>
              <th>Motor</th>
              <th>Modelo</th>
              <th>Estado</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {data.logs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-muted-foreground">
                  Aún no hay pruebas ni generaciones registradas.
                </td>
              </tr>
            )}
            {data.logs.map((log) => (
              <tr key={log.id} className="border-t border-border/60 align-top">
                <td className="py-2 text-xs">{formatDate(log.created_at)}</td>
                <td>{log.function_key}</td>
                <td>{log.provider_key}</td>
                <td className="max-w-[180px] truncate text-xs">{log.model}</td>
                <td>{log.status}</td>
                <td className="max-w-[280px] text-xs text-muted-foreground">{log.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
