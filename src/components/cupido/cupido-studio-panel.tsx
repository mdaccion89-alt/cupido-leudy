import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, Clock3, Eye, Globe2, Trophy, Users, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { countryFlag, countryName } from "@/lib/cupido";

type StudioVideo = {
  video_id: string;
  creator_id: string;
  creator_name: string;
  country_code: string;
  follower_count: number;
  video_title: string;
  views_count: number;
  watched_seconds: number;
  created_at: string;
};

type CupidoStudioPanelProps = {
  userId: string;
  followerCount: number;
};

type CreatorStats = {
  id: string;
  name: string;
  countryCode: string;
  followers: number;
  videos: number;
  views: number;
  watchedSeconds: number;
};

function progress(value: number, target: number): number {
  return Math.min(100, Math.max(0, (value / target) * 100));
}

function GoalProgress({ label, value, target }: { label: string; value: number; target: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs text-white">
        <span>{label}</span>
        <span>{value.toLocaleString("es")} / {target.toLocaleString("es")}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-amber-300" style={{ width: `${progress(value, target)}%` }} />
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4 text-pink-200" />{label}</div>
      <p className="mt-2 font-display text-xl text-white">{value}</p>
    </div>
  );
}

export function CupidoStudioPanel({ userId, followerCount }: CupidoStudioPanelProps) {
  const { session } = useAuth();
  const globalView = session?.user.email?.toLowerCase() === "leudyfeliz81@gmail.com";
  const analytics = useQuery({
    queryKey: ["cupido-studio-analytics", userId, globalView],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cupido_get_studio_analytics");
      if (error) throw error;
      return (data ?? []) as StudioVideo[];
    },
  });

  const creators = useMemo(() => {
    const result = new Map<string, CreatorStats>();
    for (const video of analytics.data ?? []) {
      const creator = result.get(video.creator_id) ?? {
        id: video.creator_id,
        name: video.creator_name,
        countryCode: video.country_code,
        followers: Number(video.follower_count) || 0,
        videos: 0,
        views: 0,
        watchedSeconds: 0,
      };
      creator.videos += 1;
      creator.views += Number(video.views_count) || 0;
      creator.watchedSeconds += Number(video.watched_seconds) || 0;
      result.set(creator.id, creator);
    }
    return [...result.values()];
  }, [analytics.data]);

  const countryRanking = useMemo(() => {
    const countries = new Map<string, { creators: Set<string>; followers: number; videos: number; views: number; watchedSeconds: number }>();
    for (const creator of creators) {
      const country = countries.get(creator.countryCode) ?? { creators: new Set<string>(), followers: 0, videos: 0, views: 0, watchedSeconds: 0 };
      country.creators.add(creator.id);
      country.followers += creator.followers;
      country.videos += creator.videos;
      country.views += creator.views;
      country.watchedSeconds += creator.watchedSeconds;
      countries.set(creator.countryCode, country);
    }
    return [...countries.entries()].map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.views - a.views || b.watchedSeconds - a.watchedSeconds);
  }, [creators]);

  const selectedCreator = creators.find((creator) => creator.id === userId);
  const videos = analytics.data ?? [];
  const views = globalView
    ? creators.reduce((total, creator) => total + creator.views, 0)
    : (selectedCreator?.views ?? 0);
  const watchedSeconds = globalView
    ? creators.reduce((total, creator) => total + creator.watchedSeconds, 0)
    : (selectedCreator?.watchedSeconds ?? 0);
  const followers = globalView ? (selectedCreator?.followers ?? 0) : followerCount;
  const totalCreators = creators.length;

  return (
    <section className="rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-500/[0.08] via-slate-950/70 to-pink-500/[0.06] p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-amber-200/20 bg-amber-300/10 text-amber-100">
          <ChartNoAxesCombined className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg text-white">Cupido Studio</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {globalView ? "Panel global con vistas y tiempo de reproducción registrados por video y país." : "Tus vistas y horas de reproducción reales del contenido aprobado."}
          </p>
        </div>
      </div>

      {analytics.isLoading ? (
        <p className="mt-5 text-sm text-muted-foreground">Cargando estadísticas reales…</p>
      ) : analytics.error ? (
        <p className="mt-5 text-sm text-rose-200">No se pudieron cargar las estadísticas. Actualiza la migración de Cupido e inténtalo otra vez.</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Video} label={globalView ? "Videos aprobados" : "Tus videos aprobados"} value={videos.length.toLocaleString("es")} />
            <Metric icon={Eye} label={globalView ? "Vistas reales" : "Vistas reales"} value={views.toLocaleString("es")} />
            <Metric icon={Clock3} label="Horas reales" value={(watchedSeconds / 3600).toLocaleString("es", { maximumFractionDigits: 1 })} />
            <Metric icon={Users} label={globalView ? "Creadores con videos" : "Seguidores reales"} value={globalView ? totalCreators.toLocaleString("es") : followers.toLocaleString("es")} />
          </div>

          {!globalView && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Trophy className="size-4 text-amber-200" />Meta inicial de monetización</p>
                <div className="space-y-3">
                  <GoalProgress label="Seguidores" value={followers} target={1000} />
                  <GoalProgress label="Horas reproducidas" value={watchedSeconds / 3600} target={1000} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {followers >= 1000 && watchedSeconds >= 3_600_000 ? "Meta alcanzada: 1.000 seguidores y 1.000 horas." : "Alcanza 1.000 seguidores y 1.000 horas reales."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Trophy className="size-4 text-pink-200" />Meta avanzada</p>
                <div className="space-y-3">
                  <GoalProgress label="Seguidores" value={followers} target={50_000} />
                  <GoalProgress label="Vistas reales" value={views} target={3_000_000} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {followers >= 50_000 && views >= 3_000_000 ? "Meta avanzada alcanzada." : "Alcanza 50.000 seguidores y 3.000.000 de vistas."}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Globe2 className="size-4 text-sky-200" />Ranking por país</h3>
              {!countryRanking.length ? (
                <p className="text-xs text-muted-foreground">Aún no hay videos aprobados con métricas.</p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {countryRanking.map((country, index) => (
                    <div key={country.code} className="flex items-center gap-2 rounded-xl border border-white/5 px-3 py-2">
                      <span className="w-5 text-xs text-amber-200">{index + 1}.</span>
                      <span>{countryFlag(country.code)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-white">{countryName(country.code)}</p>
                        <p className="text-[10px] text-muted-foreground">{country.creators.size.toLocaleString("es")} creadores · {country.followers.toLocaleString("es")} seguidores</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-white">{country.views.toLocaleString("es")} vistas</p>
                        <p className="text-[10px] text-muted-foreground">{(country.watchedSeconds / 3600).toLocaleString("es", { maximumFractionDigits: 1 })} h</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Eye className="size-4 text-pink-200" />Vistas y horas por video</h3>
              {!videos.length ? (
                <p className="text-xs text-muted-foreground">Tus videos aprobados aparecerán aquí.</p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {videos.map((video) => (
                    <div key={video.video_id} className="rounded-xl border border-white/5 px-3 py-2">
                      <p className="truncate text-xs font-medium text-white">{video.video_title}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {globalView ? `${video.creator_name} · ${countryFlag(video.country_code)} ${countryName(video.country_code)} · ` : ""}
                        {new Date(video.created_at).toLocaleDateString("es")} · {Number(video.views_count).toLocaleString("es")} vistas · {(Number(video.watched_seconds) / 3600).toLocaleString("es", { maximumFractionDigits: 1 })} h vistas
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {globalView && creators.length > 0 && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Trophy className="size-4 text-amber-200" />Creadores y metas</h3>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {[...creators].sort((a, b) => b.views - a.views).map((creator) => {
                  const hours = creator.watchedSeconds / 3600;
                  const firstGoal = creator.followers >= 1000 && hours >= 1000;
                  const secondGoal = creator.followers >= 50_000 && creator.views >= 3_000_000;
                  return (
                    <div key={creator.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-white">{creator.name} · {countryFlag(creator.countryCode)} {countryName(creator.countryCode)}</p>
                        <p className="text-[10px] text-muted-foreground">{creator.followers.toLocaleString("es")} seguidores · {hours.toLocaleString("es", { maximumFractionDigits: 1 })} h · {creator.views.toLocaleString("es")} vistas</p>
                      </div>
                      {firstGoal && <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200">1K + 1K h</span>}
                      {secondGoal && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] text-amber-100">50K + 3M</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
