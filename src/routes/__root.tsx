import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
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
import { Star, Wallet, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import appCss from "../styles.css?url";
import { BottomNav, RouteShortcuts } from "@/components/cupido/bottom-nav";
import { SiteHeader } from "@/components/studio/site-header";
import { TermsModal } from "@/components/cupido/terms-modal";
import { EscudoWidget } from "@/components/cupido/escudo-widget";
import { WeeklyRankingProvider } from "@/components/cupido/weekly-ranking";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { hideFeedBanner, initializeAdMob, maybeShowInterstitialAd, setAdsEnabled, showFeedBanner } from "@/lib/admob";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { siteSettingsQuery } from "@/lib/account";
import { BRAND, SLOGAN } from "@/lib/cupido";
import { registerCupidoReferral } from "@/lib/referral.functions";
import { captureReferralFromUrl, clearStoredReferral, getStoredReferral } from "@/lib/referral";

const NATIVE_SERVER_ORIGIN = "https://leudyia.onrender.com";
const WELCOME_BANNER_SESSION_KEY = "cupido-welcome-banner-shown";

if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const requestUrl = new URL(rawUrl, window.location.origin);
    if (!requestUrl.pathname.startsWith("/_serverFn")) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set("Accept", "application/json");
    if ((init?.body || (input instanceof Request && input.method !== "GET")) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, NATIVE_SERVER_ORIGIN);
    const request = input instanceof Request ? new Request(target, input) : target;
    return originalFetch(request, { ...init, mode: "cors", credentials: "include", headers });
  };
}

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
      { name: "google", content: "notranslate" },
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
    <html lang="es" className="dark" translate="no">
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
    const ref = getStoredReferral() || String(session.user.user_metadata?.["referral_code"] ?? "");
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
  const queryClient = useQueryClient();
  const settings = useQuery(siteSettingsQuery);
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    void initializeAdMob();
  }, []);

  useEffect(() => {
    setAdsEnabled(settings.data?.ads_enabled === true);
  }, [settings.data?.ads_enabled]);

  useEffect(() => {
    const channel = supabase
      .channel("cupido-admob-site-settings")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "site_settings", filter: "id=eq.1" }, () => {
        void queryClient.invalidateQueries({ queryKey: siteSettingsQuery.queryKey });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    const placement = pathname === "/chat" || pathname === "/mensajes"
      ? "messages"
      : pathname === "/descubrir"
        ? "discover"
        : null;
    if (settings.data?.ads_enabled !== true) void hideFeedBanner();
    else if (placement) void showFeedBanner(placement);
    else void hideFeedBanner();

    const canShowBetweenRoutes = (path: string) => !["/directo", "/live", "/tienda", "/retiro", "/chat", "/admin", "/auth"].some((blocked) => path === blocked || path.startsWith(`${blocked}/`));
    if (previous && previous !== pathname && settings.data?.ads_enabled === true && canShowBetweenRoutes(previous) && canShowBetweenRoutes(pathname)) {
      void maybeShowInterstitialAd();
    }
  }, [pathname, settings.data?.ads_enabled]);

  useEffect(
    () => () => {
      void hideFeedBanner();
    },
    [],
  );

  return null;
}

function GlobalFeedBanner() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const settings = useQuery(siteSettingsQuery);
  const started = useRef(false);
  const text = settings.data?.banner_text?.trim() ?? "";
  const image = settings.data?.banner_image?.trim() ?? "";

  useEffect(() => {
    if (pathname !== "/" && pathname !== "/descubrir") return;
    if (typeof window === "undefined" || started.current || !settings.data) return;
    if (!text && !image) return;

    started.current = true;
    window.setTimeout(() => {
      if (window.sessionStorage.getItem(WELCOME_BANNER_SESSION_KEY) === "true") return;
      window.sessionStorage.setItem(WELCOME_BANNER_SESSION_KEY, "true");
      toast.custom(
        (id) => (
          <div className="pointer-events-auto flex w-[min(92vw,28rem)] items-start gap-3 rounded-2xl border border-pink-300/25 bg-[#17130f]/95 px-4 py-3 text-left shadow-[0_18px_50px_-24px_rgba(244,63,94,0.75)] backdrop-blur-xl">
            {image ? <img src={image} alt="" className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-white/15" /> : null}
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-white">{text || "Cupido Leudy ❤️"}</p>
            <button
              type="button"
              aria-label="Cerrar aviso"
              onClick={() => toast.dismiss(id)}
              className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        ),
        { duration: 4000 },
      );
    }, 4700);
  }, [pathname, settings.data, text, image]);

  return null;
}

function IntroSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 4500);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden bg-[#080607]" role="dialog" aria-label="Bienvenida a Cupido Leudy">
      <video
        src="/intro-cupido.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 size-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/25 to-black/85" />
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="absolute right-5 top-[calc(env(safe-area-inset-top)+1.25rem)] z-10 rounded-full border border-white/20 bg-black/45 px-4 py-2 text-xs font-semibold text-white backdrop-blur-xl transition hover:bg-black/65"
      >
        Saltar
      </button>
      <div className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-6 text-white">
        <div className="relative grid size-24 place-items-center rounded-[1.75rem] border border-amber-200/25 bg-black/45 shadow-[0_20px_80px_-20px_rgba(244,63,94,0.75)] backdrop-blur-xl">
          <span className="absolute inset-0 rounded-[1.75rem] animate-pulse-glow" />
          <Wallet className="size-11 text-amber-100" strokeWidth={1.6} />
          <Star className="absolute left-1/2 top-0 size-9 animate-splash-star fill-amber-200 text-amber-100 drop-shadow-[0_0_16px_rgba(251,191,36,0.95)]" />
        </div>
        <div className="text-center">
          <p className="font-display text-2xl text-white drop-shadow-lg">Bienvenido a Cupido Leudy ❤️</p>
        </div>
      </div>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [messageKeyboardOpen, setMessageKeyboardOpen] = useState(false);
  const isMessageRoute = pathname === "/chat" || pathname === "/mensajes";
  const isDownloadRoute = pathname === "/descargar";
  const immersiveVideos = pathname.startsWith("/videos");
  const immersiveMessages = pathname === "/chat";
  const immersive = immersiveVideos || immersiveMessages;

  useEffect(() => {
    if (!isMessageRoute) {
      setMessageKeyboardOpen(false);
      return;
    }

    const viewport = window.visualViewport;
    let editorFocused = false;
    const isComposerFocused = () => document.activeElement instanceof HTMLElement
      && document.activeElement.matches("[data-message-composer]");
    const updateKeyboardState = (fromViewportEvent = false) => {
      editorFocused = editorFocused && isComposerFocused();
      const viewportDelta = viewport
        ? Math.max(window.innerHeight - viewport.height, viewport.offsetTop)
        : 1;
      const keyboardVisible = !viewport || viewportDelta > 100;
      setMessageKeyboardOpen(editorFocused && (fromViewportEvent ? keyboardVisible : true));
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-message-composer]")) return;
      editorFocused = true;
      updateKeyboardState();
    };
    const handleFocusOut = () => window.requestAnimationFrame(() => updateKeyboardState(true));
    const handleViewportChange = () => updateKeyboardState(true);

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [isMessageRoute]);

  return (
    <QueryClientProvider client={queryClient}>
      <IntroSplash />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AuthProvider>
        <WeeklyRankingProvider>
        <ThemeSync onThemeChange={setTheme} />
        <SystemNotificationSetup />
        <LoginMetadataSetup />
        <AdController />
        <ReferralTracker />
        <AndroidBackHandler />
        <div className={`relative flex min-h-[100svh] flex-col overflow-x-hidden ${isDownloadRoute ? "min-h-[100dvh]" : "h-[100dvh]"}`}>
          {!immersive && !isDownloadRoute && <SiteHeader />}
          {!immersive && !isDownloadRoute && <RouteShortcuts />}
          <div
            translate="no"
            className={`min-h-0 flex-1 overflow-x-hidden ${isDownloadRoute || immersive ? "overflow-hidden pb-0" : "overflow-y-auto overscroll-y-contain pb-[calc(4.5rem+env(safe-area-inset-bottom))]"}`}
          >
            <GlobalFeedBanner />
            <AccountScopedOutlet />
          </div>
          {!immersive && !isDownloadRoute && !messageKeyboardOpen && <BottomNav />}
        </div>
        {!isDownloadRoute && <EscudoWidget />}
        {!isDownloadRoute && <TermsModal />}
        <Toaster theme={theme} position="top-center" />
        </WeeklyRankingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AndroidBackHandler() {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    let active = true;
    let listener: Awaited<ReturnType<typeof App.addListener>> | undefined;
    void App.addListener("backButton", ({ canGoBack }) => {
      if (!active) return;
      const appBack = new Event("cupido:android-back", { cancelable: true });
      window.dispatchEvent(appBack);
      if (appBack.defaultPrevented) return;
      const openDialog = document.querySelector('[role="dialog"][data-state="open"]');
      if (openDialog) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      if (canGoBack || window.history.length > 1) {
        router.history.back();
      } else if (pathname !== "/") {
        void router.navigate({ to: "/" });
      }
    }).then((handle) => {
      if (active) listener = handle;
      else void handle.remove();
    });
    return () => {
      active = false;
      void listener?.remove();
    };
  }, [pathname, router]);

  return null;
}

function AccountScopedOutlet() {
  const { session } = useAuth();
  return <Outlet key={session?.user.id ?? "guest"} />;
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
        .select("theme_mode,notifications_enabled,sound_enabled")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return {
        theme_mode: data?.theme_mode === "light" ? "light" as const : "dark" as const,
        notifications_enabled: data?.notifications_enabled !== false,
        sound_enabled: data?.sound_enabled !== false,
      };
    },
  });
  const siteSettings = useQuery(siteSettingsQuery);

  useEffect(() => {
    const mode = preference.data?.theme_mode ?? (localStorage.getItem("cupido-dark") === "false" ? "light" : "dark");
    const root = document.documentElement;
    root.dataset["theme"] = mode;
    root.dataset["themePreset"] = siteSettings.data?.theme_preset ?? "cafe";
    root.classList.toggle("dark", mode === "dark");
    localStorage.setItem("cupido-dark", String(mode === "dark"));
    if (preference.data) {
      localStorage.setItem("cupido-notifications", String(preference.data.notifications_enabled));
      localStorage.setItem("cupido-sounds", String(preference.data.sound_enabled));
    }
    onThemeChange(mode);
  }, [preference.data, siteSettings.data?.theme_preset, onThemeChange]);

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

function LoginMetadataSetup() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const cacheKey = `cupido-login-metadata-${userId}`;
    const previous = Number(localStorage.getItem(cacheKey) || 0);
    if (Date.now() - previous < 86_400_000) return;
    const language = navigator.language || "es";
    document.documentElement.lang = language.split("-")[0] || "es";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void fetch("https://ipapi.co/json/", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Country lookup failed");
        return await response.json() as { country_code?: string; ip?: string };
      })
      .then(async (location) => {
        const country = (location.country_code || "").toUpperCase().slice(0, 2);
        if (country) localStorage.setItem("cupido-country-code", country);
        const { error } = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
          .rpc("cupido_update_login_metadata", { _country: country, _language: language, _ip: location.ip ?? null });
        if (error) throw error;
        localStorage.setItem(cacheKey, String(Date.now()));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.warn("[profile] No se pudo guardar país e idioma detectados.");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [userId]);

  return null;
}
