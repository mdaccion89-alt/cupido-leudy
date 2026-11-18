## Project rules
- Music generation runs only in `generateSong` (src/lib/music.functions.ts), an authenticated server function: it records the song row first, calls the music provider once, then saves the MP3 to the private `songs` bucket under `<userId>/`. Why: one billable call per Generate click and owner-only playback.
- Genre, duration, model choice and prompt building live in src/lib/music.ts (pure, covered by music.test.ts). Why: browser and server share one source of truth.
- Auth state has one subscriber (`AuthProvider` in src/lib/auth-context.tsx, mounted in __root). Why: avoids duplicate onAuthStateChange listeners.
- The studio at `/` is public; signed-out visitors get inline sign-in prompts instead of redirects. Why: the main screen should always be visible.
