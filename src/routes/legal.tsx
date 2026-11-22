import { createFileRoute } from "@tanstack/react-router";
import { LegalLinks } from "@/components/cupido/legal-links";
import { TERMS_TEXT, TERMS_TITLE } from "@/lib/cupido";

type LegalDocument = "terms" | "privacy" | "age";

export const Route = createFileRoute("/legal")({
  validateSearch: (search: { doc?: string }) => search,
  head: () => ({ meta: [{ title: "Información legal — Cupido Leudy" }] }),
  component: LegalPage,
});

function LegalPage() {
  const { doc } = Route.useSearch();
  const document: LegalDocument = doc === "privacy" || doc === "age" ? doc : "terms";
  const heading = document === "terms" ? TERMS_TITLE : document === "privacy" ? "Política de Privacidad" : "Servicio exclusivo para mayores de 18 años";

  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-3xl px-5 py-10 sm:px-8">
      <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-9">
        <LegalLinks className="mb-7 justify-start" />
        <h1 className="font-display text-2xl text-white">{heading}</h1>
        <div className="mt-5 whitespace-pre-wrap text-sm leading-7 text-foreground/80">
          {document === "terms" ? TERMS_TEXT : document === "age" ? (
            "Cupido Leudy está destinado exclusivamente a personas de 18 años o más. Al crear una cuenta declaras que tienes al menos 18 años. No se permite el acceso ni la publicación de contenido por menores. Si detectas una cuenta que pueda pertenecer a un menor, repórtala desde su perfil."
          ) : (
            "Cupido Leudy utiliza la información que proporcionas para crear y administrar tu perfil, permitir conexiones, mensajes, comentarios, transmisiones y pagos, y proteger la comunidad. Los archivos que publicas se almacenan en Supabase Storage; los datos de cuenta y actividad se guardan en Supabase. Los pagos se procesan mediante PayPal y la aplicación no recibe ni almacena los datos completos de tu tarjeta.\n\nPuedes actualizar la información de tu perfil desde Ajustes. Los reportes se conservan para moderación y seguridad. Evita publicar información sensible en áreas públicas. Para solicitar ayuda con tu cuenta o tus datos, contacta al Administrador desde la aplicación."
          )}
        </div>
      </article>
    </main>
  );
}
