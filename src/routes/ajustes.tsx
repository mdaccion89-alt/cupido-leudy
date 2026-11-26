import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { ProfileSettings } from "@/components/cupido/profile-settings";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes — Cupido Leudy ❤️" }] }),
  component: () => (
    <SafeViewBoundary label="tus ajustes">
      <AjustesPage />
    </SafeViewBoundary>
  ),
});

function AjustesPage() {
  const { session, loading } = useAuth();
  const userId = typeof session?.user.id === "string" ? session.user.id : null;

  const profile = useQuery({
    queryKey: ["cupido-ajustes", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      const preferences = data as (NonNullable<typeof data> & {
        show_live_previews?: boolean | null;
        pip_enabled?: boolean | null;
        preferred_gender?: string | null;
      }) | null;
      return {
        email: preferences?.email ?? null,
        phone: preferences?.phone ?? null,
        show_live_previews: preferences?.show_live_previews ?? true,
        pip_enabled: preferences?.pip_enabled ?? true,
        preferred_gender: preferences?.preferred_gender ?? "Ambos",
      };
    },
  });

  if (loading || profile.isLoading)
    return (
      <main className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando ajustes…
      </main>
    );

  if (profile.isError)
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">No se pudieron cargar tus ajustes</h1>
          <p className="mt-2 text-sm text-muted-foreground">Intenta recargar en unos segundos.</p>
          <Button className="mt-5" onClick={() => void profile.refetch()}>
            Reintentar
          </Button>
        </div>
      </main>
    );

  if (!userId)
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">Inicia sesión para ver tus ajustes</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tus preferencias y tu cuenta están protegidas.
          </p>
          <Button asChild className="mt-5">
            <Link to="/auth" search={{ ref: "" }}>
              Iniciar sesión
            </Link>
          </Button>
        </div>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <h1 className="mb-6 font-display text-2xl text-white sm:text-3xl">Mi cuenta y ajustes</h1>
      <ProfileSettings email={profile.data?.email} phone={profile.data?.phone} />
      <TrustPanel />
    </main>
  );
}

function TrustPanel() {
  return (
    <section className="mt-6 rounded-2xl border border-mint/25 bg-mint/[0.06] p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-mint">
        <ShieldCheck className="size-4" /> Transparencia y seguridad
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-white/65">
        Información clara para una experiencia segura, misma edad mínima y cumplimiento de las políticas de la tienda.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <a href="/legal?doc=privacy" className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white/80 hover:border-mint/30 hover:text-mint">
          <FileText className="size-4 shrink-0" /> Privacidad y datos
        </a>
        <a href="/legal?doc=ads" className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white/80 hover:border-mint/30 hover:text-mint">
          <ShieldCheck className="size-4 shrink-0" /> Anuncios y monedas
        </a>
        <a href="/legal?doc=permissions" className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white/80 hover:border-mint/30 hover:text-mint">
          <Smartphone className="size-4 shrink-0" /> Permisos de la app
        </a>
        <a href="/eliminar-cuenta" className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white/80 hover:border-rose-300/30 hover:text-rose-200">
          <Trash2 className="size-4 shrink-0" /> Eliminar cuenta y datos
        </a>
      </div>
    </section>
  );
}
