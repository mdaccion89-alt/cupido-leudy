import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GIFTS, type Gift } from "@/lib/cupido";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_RETRY_INTERVAL_MS = 30 * 1000;

let catalog: readonly Gift[] = GIFTS;
let lastSyncedAt = 0;
let retryAfter = 0;
let syncPromise: Promise<readonly Gift[]> | null = null;
let catalogChannel: ReturnType<typeof supabase.channel> | null = null;
const catalogListeners = new Set<() => void>();

export function getGiftCatalog(): readonly Gift[] {
  return catalog;
}

export function findGiftById(id: string): Gift | undefined {
  return catalog.find((gift) => gift.id === id);
}

export async function syncGiftCatalog(): Promise<readonly Gift[]> {
  const now = Date.now();
  if (now < retryAfter || now - lastSyncedAt < REFRESH_INTERVAL_MS) return catalog;
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const { data, error } = await supabase
      .from("cupido_gifts")
      .select("id,name,emoji,credits,cash,sort_order")
      .order("sort_order", { ascending: true });
    if (error) throw error;

    const localIds = new Set(GIFTS.map((gift) => gift.id));
    const customById = new Map<string, Gift>();
    for (const row of data ?? []) {
      if (localIds.has(row.id) || !row.id || !row.name || !row.emoji) continue;
      customById.set(row.id, {
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        credits: Number(row.credits),
        cash: Number(row.cash),
        imageIndex: -1,
      });
    }

    catalog = [...GIFTS, ...customById.values()];
    lastSyncedAt = Date.now();
    retryAfter = 0;
    catalogListeners.forEach((listener) => listener());
    return catalog;
  })()
    .catch((error: unknown) => {
      retryAfter = Date.now() + ERROR_RETRY_INTERVAL_MS;
      console.warn("[gifts] No se pudieron sincronizar regalos personalizados; se mantiene el catálogo local.", error);
      return catalog;
    })
    .finally(() => {
      syncPromise = null;
    });

  return syncPromise;
}

export function useGiftCatalog(): readonly Gift[] {
  const [currentCatalog, setCurrentCatalog] = useState<readonly Gift[]>(getGiftCatalog);

  useEffect(() => {
    const updateCatalog = () => setCurrentCatalog(getGiftCatalog());
    catalogListeners.add(updateCatalog);
    if (!catalogChannel) {
      catalogChannel = supabase
        .channel("cupido-gift-catalog-cache")
        .on("postgres_changes", { event: "*", schema: "public", table: "cupido_gifts" }, () => {
          lastSyncedAt = 0;
          retryAfter = 0;
          void syncGiftCatalog();
        })
        .subscribe();
    }
    void syncGiftCatalog();
    return () => {
      catalogListeners.delete(updateCatalog);
      if (catalogListeners.size === 0 && catalogChannel) {
        void supabase.removeChannel(catalogChannel);
        catalogChannel = null;
      }
    };
  }, []);

  return currentCatalog;
}
