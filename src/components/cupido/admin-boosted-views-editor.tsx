import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type BoostedViewsEditorProps = {
  postId: string;
  boostedViews: number;
  className?: string;
  onSaved?: () => void;
};

const adminViewsDb = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: number | string | null; error: { message: string } | null }>;
};

export function AdminBoostedViewsEditor({ postId, boostedViews, className = "", onSaved }: BoostedViewsEditorProps) {
  const [value, setValue] = useState(String(boostedViews));
  const [saving, setSaving] = useState<"set" | "add" | null>(null);

  useEffect(() => setValue(String(boostedViews)), [boostedViews]);

  const apply = async (mode: "set" | "add") => {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      toast.error("Ingresa una cantidad de vistas de impulso válida.");
      return;
    }
    setSaving(mode);
    try {
      const { data, error } = await adminViewsDb.rpc("cupido_admin_adjust_post_boosted_views", {
        _post_id: postId,
        _views: amount,
        _mode: mode,
      });
      if (error) throw new Error(error.message || "No se pudieron actualizar las vistas de impulso.");
      setValue(String(Number(data ?? 0)));
      toast.success(mode === "add" ? "Vistas de impulso sumadas." : "Vistas de impulso actualizadas.");
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-[11px] text-white/70" htmlFor={`boosted-views-${postId}`}>Vistas de impulso (no monetizables)</label>
      <Input
        id={`boosted-views-${postId}`}
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-9 border-white/15 bg-black/30 text-xs text-white"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={saving !== null} onClick={() => void apply("set")} className="h-8 flex-1 px-2 text-[11px]">
          {saving === "set" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Establecer
        </Button>
        <Button type="button" size="sm" disabled={saving !== null} onClick={() => void apply("add")} className="h-8 flex-1 px-2 text-[11px]">
          {saving === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Sumar
        </Button>
      </div>
    </div>
  );
}
