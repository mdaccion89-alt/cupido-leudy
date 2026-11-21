import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";

import appCss from "../styles.css?url";
import { BottomNav } from "@/components/cupido/bottom-nav";
import { SiteHeader } from "@/components/studio/site-header";
import { TermsModal } from "@/components/cupido/terms-modal";
import { EscudoWidget } from "@/components/cupido/escudo-widget";
import { Toaster } from "@/components/ui/sonner";
import { hideFeedBanner, initializeAdMob, showFeedBanner } from "@/lib/admob";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { BRAND, SLOGAN } from "@/lib/cupido";
import { registerCupidoReferral } from "@/lib/referral.functions";
import { captureReferralFromUrl, clearStoredReferral, getStoredReferral } from "@/lib/referral";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página no encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          La página que buscas no existe o fue movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Error técnico
        </h1>
        <pre className="mt-2 max-w-full break-words whitespace-pre-wrap text-left font-mono text-xs text-red-300">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <p className="mt-2 text-sm text-muted-foreground">
          Intenta recargar o vuelve al inicio.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Reintentar
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    // Replace these placeholders with the app's name and description when first building the app.
    // Each content route, / included, must still set its own head(). Never add og:image or
    // twitter:image here: every page without its own would inherit the root's preview image.
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: `${BRAND} — ${SLOGAN}` },
      {
        name: "description",
        content: `${SLOGAN}. Chatea, haz llamadas en vivo y verifica tu perfil con la insignia azul de ${BRAND}.`,
      },
      { name: "author", content: BRAND },
      { property: "og:title", content: `${BRAND} — ${SLOGAN}` },
      {
        property: "og:description",
        content: `${SLOGAN}. Chat, llamadas en vivo y Lives con seguridad verificada.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ReferralTracker() {
  const { session } = useAuth();
  const register = useServerFn(registerCupidoReferral);
  const handled = useRef(false);

  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  useEffect(() => {
    if (!session || handled.current) return;
    const ref = getStoredReferral();
    if (!ref) return;
    handled.current = true;
    void register({ data: { ref } })
      .then(() => clearStoredReferral())
      .catch(() => {
        handled.current = false;
      });
  }, [session, register]);

  return null;
}

function AdController() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    void initializeAdMob();
  }, []);

  useEffect(() => {
    const inFeed =
      pathname.startsWith("/muro") || pathname.startsWith("/comunidad") || pathname.startsWith("/siguiendo");
    const hidden = pathname.startsWith("/llamadas") || pathname.startsWith("/chat");
    if (inFeed && !hidden) void showFeedBanner();
    else void hideFeedBanner();
  }, [pathname]);

  useEffect(
    () => () => {
      void hideFeedBanner();
    },
    [],
  );

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AuthProvider>
        <ThemeSync onThemeChange={setTheme} />
        <SystemNotificationSetup />
        <AdController />
        <ReferralTracker />
        <div className="flex min-h-screen flex-col pb-20">
          <SiteHeader />
          <div className="flex-1">
            <Outlet />
          </div>
          <BottomNav />
        </div>
        <EscudoWidget />
        <TermsModal />
        <Toaster theme={theme} position="top-center" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ThemeSync({ onThemeChange }: { onThemeChange: (theme: "dark" | "light") => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const preference = useQuery({
    queryKey: ["cupido-preferences", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("theme_mode,notifications_enabled,sounds_enabled")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return {
        theme_mode: data?.theme_mode === "light" ? "light" as const : "dark" as const,
        notifications_enabled: data?.notifications_enabled !== false,
        sounds_enabled: data?.sounds_enabled !== false,
      };
    },
  });

  useEffect(() => {
    const mode = preference.data?.theme_mode ?? (localStorage.getItem("cupido-dark") === "false" ? "light" : "dark");
    const root = document.documentElement;
    root.dataset["theme"] = mode;
    root.classList.toggle("dark", mode === "dark");
    localStorage.setItem("cupido-dark", String(mode === "dark"));
    if (preference.data) {
      localStorage.setItem("cupido-notifications", String(preference.data.notifications_enabled));
      localStorage.setItem("cupido-sounds", String(preference.data.sounds_enabled));
    }
    onThemeChange(mode);
  }, [preference.data, onThemeChange]);

  return null;
}

function SystemNotificationSetup() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("[notifications] No se pudo registrar el Service Worker.", error);
    });
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch((error: unknown) => {
        console.error("[notifications] No se pudo solicitar permiso de notificaciones.", error);
      });
    }
  }, [userId]);

  return null;
}
