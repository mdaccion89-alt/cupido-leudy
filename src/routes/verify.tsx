import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/verify")({
  validateSearch: (search: { song?: string }) => search,
  head: () => ({ meta: [{ title: "Verificar licencia — Leudy IA Adobe" }] }),
  component: VerifyPage,
});

function VerifyPage() {
  const { song } = Route.useSearch();
  const query = useQuery({
    queryKey: ["license", song],
    enabled: Boolean(song),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_license", { _song_id: song! });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="panel grain w-full max-w-lg p-8">
        <div className="flex items-center gap-3">
          <BadgeCheck className="size-8 text-primary" />
          <h1 className="font-display text-xl font-semibold">Verificación de licencia</h1>
        </div>
        {!song ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Abre este enlace con el parámetro `?song=ID`.
          </p>
        ) : query.isLoading ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" /> Verificando…
          </p>
        ) : query.error || !query.data ? (
          <p className="mt-5 text-sm text-destructive">
            No se encontró una licencia válida para esta obra.
          </p>
        ) : (
          <dl className="mt-6 space-y-3 text-sm">
            <Row label="Obra" value={query.data.title} />
            <Row label="Creador" value={query.data.creator_name} />
            <Row label="Género" value={query.data.genre} />
            <Row label="Fecha" value={new Date(query.data.created_at).toLocaleString("es")} />
            <Row label="Huella" value={query.data.fingerprint || "N/D"} />
            <Row
              label="Content ID"
              value={query.data.content_id_eligible ? "Elegible" : "No elegible"}
            />
          </dl>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
