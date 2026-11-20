import { Link } from "@tanstack/react-router";
import { FOOTER_COPYRIGHT } from "@/lib/cupido";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/80 px-5 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{FOOTER_COPYRIGHT}</p>
        <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Enlaces del sitio">
          <Link to="/" className="text-muted-foreground transition hover:text-foreground">
            Inicio
          </Link>
          <Link to="/comunidad" className="text-muted-foreground transition hover:text-foreground">
            Descubrir
          </Link>
          <Link to="/chat" className="text-muted-foreground transition hover:text-foreground">
            Chat
          </Link>
          <Link to="/llamadas" className="text-muted-foreground transition hover:text-foreground">
            Llamadas
          </Link>
          <Link to="/tienda" className="text-muted-foreground transition hover:text-foreground">
            Tienda
          </Link>
        </nav>
      </div>
    </footer>
  );
}
