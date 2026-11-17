<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Music generation runs only in `generateSong` (src/lib/music.functions.ts), an authenticated server function: it records the song row first, calls the AI gateway `/v1/music` once, then saves the MP3 to the private `songs` bucket under `<userId>/`. Why: one billable call per Generate click and owner-only playback.
- Genre, duration, model choice and prompt building live in src/lib/music.ts (pure, covered by music.test.ts). Why: browser and server share one source of truth.
- Auth state has one subscriber (`AuthProvider` in src/lib/auth-context.tsx, mounted in __root). Why: avoids duplicate onAuthStateChange listeners.
- The studio at `/` is public; signed-out visitors get inline sign-in prompts instead of redirects. Why: the main screen should always be visible.
