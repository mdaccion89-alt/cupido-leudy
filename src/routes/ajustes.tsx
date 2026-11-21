import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
        .select("email,phone")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
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
    </main>
  );
}
