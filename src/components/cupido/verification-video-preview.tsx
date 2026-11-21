import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function VerificationVideoPreview({ path }: { path: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.storage.from("cupido-private").createSignedUrl(path, 300).then(({ data, error: signedUrlError }) => {
      if (!active) return;
      if (signedUrlError) setError(true);
      else setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path]);

  if (!url) return <p className="flex h-40 items-center justify-center rounded-xl bg-black/40 text-xs text-muted-foreground">{error ? "No se pudo abrir el video privado." : "Cargando video…"}</p>;
  return <video src={url} controls playsInline className="max-h-80 w-full rounded-xl bg-black object-contain" />;
}
