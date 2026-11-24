import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/eliminar-cuenta")({
  head: () => ({
    meta: [
      { title: "Eliminar cuenta y datos — Cupido Leudy" },
      { name: "description", content: "Instrucciones públicas para solicitar la eliminación de una cuenta y sus datos de Cupido Leudy." },
    ],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-background px-4 pb-24 pt-[calc(env(safe-area-inset-top)+2rem)] text-foreground sm:px-6">
      <article className="mx-auto w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl sm:p-8">
        <div className="grid size-14 place-items-center rounded-2xl border border-rose-300/20 bg-rose-500/10 text-rose-200">
          <Trash2 className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-white sm:text-3xl">Eliminar cuenta y datos</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Puedes solicitar la eliminación de tu cuenta de Cupido Leudy y de los datos asociados. La opción está disponible dentro de la aplicación y requiere dos confirmaciones para evitar una eliminación accidental.
        </p>

        <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white"><ShieldCheck className="size-5 text-emerald-300" /> Desde la aplicación</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-white/75">
            <li>Inicia sesión en la cuenta que quieres eliminar.</li>
            <li>Abre <strong className="text-white">Perfil → Ajustes</strong>.</li>
            <li>Toca <strong className="text-white">Eliminar mi cuenta y datos</strong>.</li>
            <li>Lee el aviso, continúa y escribe <strong className="text-white">ELIMINAR</strong> para confirmar por segunda vez.</li>
          </ol>
          <p className="mt-4 text-xs leading-relaxed text-white/55">Al completar el proceso se cierra la sesión y se eliminan la cuenta, el perfil, el contenido publicado, los mensajes y los archivos asociados.</p>
          <Button asChild className="mt-4 min-h-11 w-full sm:w-auto">
            <Link to="/auth" search={{ ref: "" }}><ArrowLeft className="size-4" /> Iniciar sesión para eliminar mi cuenta</Link>
          </Button>
        </section>

        <section className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-500/[0.06] p-4 sm:p-5">
          <h2 className="text-base font-semibold text-amber-100">¿No puedes iniciar sesión?</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/70">Envía la solicitud desde el correo asociado a la cuenta e incluye tu nombre de usuario y el correo de acceso para que podamos identificarla.</p>
          <Button asChild variant="outline" className="mt-4 min-h-11 w-full whitespace-normal text-center sm:w-auto">
            <a href="mailto:leudyfeliz81@gmail.com?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20cuenta%20-%20Cupido%20Leudy"><Mail className="size-4 shrink-0" /> Solicitar eliminación por correo</a>
          </Button>
        </section>

        <p className="mt-6 text-center text-xs text-white/45">Esta página pública explica cómo solicitar la eliminación de datos de Cupido Leudy.</p>
      </article>
    </main>
  );
}
