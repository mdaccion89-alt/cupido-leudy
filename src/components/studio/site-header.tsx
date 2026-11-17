import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Equalizer } from "./equalizer";

export function SiteHeader() {
  const { session, loading } = useAuth();
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
      <Link to="/" className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
          <Equalizer bars={4} className="h-4 [&>span]:bg-primary-foreground [&>span]:bg-none" />
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">
          Leudy <span className="text-primary">IA</span> Adobe
        </span>
      </Link>
      {!loading &&
        (session ? (
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[200px] truncate text-sm text-muted-foreground sm:block">
              {session.user.email}
            </span>
            <Button variant="glass" size="pill" onClick={() => supabase.auth.signOut()}>
              <LogOut /> Salir
            </Button>
          </div>
        ) : (
          <Button asChild variant="glass" size="pill">
            <Link to="/auth">Iniciar sesión</Link>
          </Button>
        ))}
    </header>
  );
}
