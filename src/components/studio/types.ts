import type { Tables } from "@/integrations/supabase/types";
export type Song = Tables<"songs">;

export type StudioResult =
  | {
      ok: true;
      songId: string;
      blob?: Blob;
      mediaType?: string;
      title?: string;
      kind?: "audio" | "video";
    }
  | { ok: false; status: number; message: string };

export type StudioTabProps = {
  signedIn: boolean;
  userId: string | null;
  songs: Song[];
  requireSignIn: () => void;
  onPendingChange: (pending: boolean, label: string) => void;
  onResult: (result: StudioResult, successMessage: string) => void;
  disabledReason?: string | undefined;
  isAdmin?: boolean;
};

export function isWorking(song: Pick<Song, "status">) {
  return song.status === "generating" || song.status === "saving";
}
