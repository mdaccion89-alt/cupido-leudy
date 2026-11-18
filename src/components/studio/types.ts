import type { Tables } from "@/integrations/supabase/types";
import type { ActionResult } from "@/lib/music.functions";
export type Song = Tables<"songs">;

export type StudioTabProps = {
  signedIn: boolean;
  userId: string | null;
  songs: Song[];
  requireSignIn: () => void;
  onPendingChange: (pending: boolean, label: string) => void;
  onResult: (result: ActionResult, successMessage: string) => void;
  disabledReason?: string | undefined;
};

export function isWorking(song: Pick<Song, "status">) {
  return song.status === "generating" || song.status === "saving";
}
