import { createFileRoute } from "@tanstack/react-router";
import { LegalLinks } from "@/components/cupido/legal-links";
import {
  ADS_TEXT,
  AGE_TEXT,
  PERMISSIONS_TEXT,
  PRIVACY_TEXT,
  TERMS_TEXT,
  TERMS_TITLE,
} from "@/lib/cupido";

type LegalDocument = "terms" | "privacy" | "age" | "ads" | "permissions";

const LEGAL_DOCUMENTS: Record<LegalDocument, { title: string; body: string }> = {
  terms: { title: TERMS_TITLE, body: TERMS_TEXT },
  privacy: { title: "Política de Privacidad", body: PRIVACY_TEXT },
  age: { title: "Servicio exclusivo para mayores de 18 años", body: AGE_TEXT },
  ads: { title: "Anuncios y monedas brillantes", body: ADS_TEXT },
  permissions: { title: "Permisos de la aplicación", body: PERMISSIONS_TEXT },
};

export const Route = createFileRoute("/legal")({
  validateSearch: (search: { doc?: string }) => search,
  head: () => ({ meta: [{ title: "Información legal — Cupido Leudy" }] }),
  component: LegalPage,
});

function LegalPage() {
  const { doc } = Route.useSearch();
  const document: LegalDocument =
    doc === "privacy" || doc === "age" || doc === "ads" || doc === "permissions" ? doc : "terms";
  const { title, body } = LEGAL_DOCUMENTS[document];

  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-3xl px-5 py-10 sm:px-8">
      <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-9">
        <LegalLinks className="mb-7 justify-start" />
        <span className="inline-flex rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-mint">
          Transparencia Cupido Leudy
        </span>
        <h1 className="mt-4 font-display text-2xl text-white">{title}</h1>
        <div className="mt-5 whitespace-pre-wrap text-sm leading-7 text-foreground/80">{body}</div>
      </article>
    </main>
  );
}
