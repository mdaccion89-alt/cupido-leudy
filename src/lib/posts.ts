import { supabase } from "@/integrations/supabase/client";

export const SUPREME_ADMIN_EMAIL = "leudyfeliz81@gmail.com";

export type FeedPost = {
  id: string;
  user_id: string;
  media_url: string;
  kind: "photo" | "video" | "text";
  caption: string;
  likes_count: number;
  dislikes_count: number;
  comments_count: number;
  saves_count: number;
  views_count: number;
  shares_count: number;
  created_at: string;
  display_name: string;
  avatar_url: string;
  is_verified_blue: boolean;
  email: string | null;
  is_super_admin: boolean;
};

export type FeedResult = {
  posts: FeedPost[];
  liked: Set<string>;
  disliked: Set<string>;
  saved: Set<string>;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  display_name: string;
  avatar_url: string;
};

type AnyRow = Record<string, any> & {
  id?: any;
  post_id?: any;
  following_id?: any;
  kind?: any;
  media_type?: any;
  user_id?: any;
  email?: any;
  is_cupido_active?: any;
  is_super_admin?: any;
  media_url?: any;
  media_path?: any;
  caption?: any;
  likes_count?: any;
  dislikes_count?: any;
  comments_count?: any;
  saves_count?: any;
  views_count?: any;
  shares_count?: any;
  created_at?: any;
  display_name?: any;
  avatar_url?: any;
  is_verified_blue?: any;
  body?: any;
};

type AnyQueryClient = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
};

const db = supabase as unknown as AnyQueryClient;

const POST_COLUMNS = "id,user_id,media_path,kind,caption,likes_count,created_at";

export function isSupremePost(email?: string | null, isSuperAdmin?: boolean | null): boolean {
  return Boolean(isSuperAdmin) || email?.toLowerCase() === SUPREME_ADMIN_EMAIL;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.floor(value)));
}

function postSeed(id?: string | null): number {
  const text = String(id ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function displayedMetrics(post?: FeedPost | null, now = Date.now()): { likes: string; views: string } {
  const realLikes = Math.max(0, Number(post?.likes_count) || 0);
  const realViews = Math.max(0, Number(post?.views_count) || 0);
  if (!isSupremePost(post?.email, post?.is_super_admin))
    return { likes: formatCount(realLikes), views: formatCount(realViews) };

  const seed = postSeed(post?.id);
  const baseLikes = 12_400 + (seed % 56_501);
  const baseViews = 19_200 + ((seed >>> 7) % 75_301);
  const published = Date.parse(String(post?.created_at ?? ""));
  const minutes = Number.isFinite(published) ? Math.max(0, Math.floor((now - published) / 60_000) - 2) : 0;
  const likeGrowth = minutes * (2 + (seed % 5));
  const viewGrowth = minutes * (12 + ((seed >>> 4) % 19));
  return {
    likes: formatCount(baseLikes + likeGrowth + realLikes),
    views: formatCount(baseViews + viewGrowth + realViews),
  };
}

async function selectPosts(
  limit: number,
  onlyUserId?: string | null,
  savedOnly = false,
  viewerId?: string | null,
  onlyUserIds?: string[] | null,
) {
  if (onlyUserIds && onlyUserIds.length === 0) return [];
  let savedIds: string[] | null = null;
  if (savedOnly) {
    if (!viewerId) return [];
    const { data } = await db.from("cupido_post_saves").select("post_id").eq("user_id", viewerId);
    savedIds = (data ?? []).map((row: AnyRow) => row.post_id as string);
    if (!savedIds?.length) return [];
  }

  let query = db.from("cupido_posts").select(POST_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  if (onlyUserId) query = query.eq("user_id", onlyUserId);
  if (onlyUserIds) query = query.in("user_id", onlyUserIds);
  if (savedIds) query = query.in("id", savedIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AnyRow[];
}

async function fetchEngagement(postIds: string[], viewerId: string | null) {
  const empty = { liked: new Set<string>(), disliked: new Set<string>(), saved: new Set<string>(), comments: new Map<string, number>() };
  if (!postIds.length) return empty;
  const [likes, dislikes, saves, comments] = await Promise.all([
    viewerId ? db.from("cupido_post_likes").select("post_id").eq("user_id", viewerId).in("post_id", postIds) : Promise.resolve({ data: [] }),
    viewerId ? db.from("cupido_post_dislikes").select("post_id").eq("user_id", viewerId).in("post_id", postIds) : Promise.resolve({ data: [] }),
    viewerId ? db.from("cupido_post_saves").select("post_id").eq("user_id", viewerId).in("post_id", postIds) : Promise.resolve({ data: [] }),
    db.from("cupido_post_comments").select("post_id").in("post_id", postIds),
  ]);
  const commentCounts = new Map<string, number>();
  for (const row of (comments.data ?? []) as AnyRow[]) {
    commentCounts.set(row.post_id, (commentCounts.get(row.post_id) ?? 0) + 1);
  }
  return {
    liked: new Set(((likes.data ?? []) as AnyRow[]).map((row) => row.post_id as string)),
    disliked: new Set(((dislikes.data ?? []) as AnyRow[]).map((row) => row.post_id as string)),
    saved: new Set(((saves.data ?? []) as AnyRow[]).map((row) => row.post_id as string)),
    comments: commentCounts,
  };
}

export async function fetchFeed(options: {
  viewerId?: string | null;
  limit?: number;
  videoOnly?: boolean;
  onlyUserId?: string | null;
  savedOnly?: boolean;
  followingOnly?: boolean;
}): Promise<FeedResult> {
  const { viewerId = null, limit = 24, videoOnly = false, onlyUserId = null, savedOnly = false, followingOnly = false } = options;
  if (followingOnly && !viewerId) {
    return { posts: [], liked: new Set(), disliked: new Set(), saved: new Set() };
  }
  let followedIds: string[] | null = null;
  if (followingOnly && viewerId) {
    const { data, error } = await db.from("follows").select("following_id").eq("follower_id", viewerId);
    if (error) throw error;
    followedIds = ((data ?? []) as AnyRow[]).map((row) => String(row.following_id));
  }
  const rows = await selectPosts(limit, onlyUserId, savedOnly, viewerId, followedIds);
  const filtered = videoOnly ? rows.filter((row) => row.kind === "video") : rows;
  const ids = [...new Set(filtered.map((row) => row.user_id as string))];
  const creatorRows = ids.length
    ? await supabase
        .from("cupido_public_profiles")
        .select("id,display_name,avatar_url,is_verified_blue,is_super_admin,is_official,is_cupido_active")
        .in("id", ids)
    : { data: [], error: null };
  if (creatorRows.error) {
    console.error("[muro] No se pudieron cargar los perfiles públicos de las publicaciones.", creatorRows.error);
    throw creatorRows.error;
  }
  const creators = new Map(((creatorRows.data ?? []) as AnyRow[]).map((row) => [row.id as string, row]));
  const postIds = filtered.map((row) => row.id as string);
  const engagement = await fetchEngagement(postIds, viewerId);

  const posts: FeedPost[] = filtered.flatMap((row): FeedPost[] => {
    if (!row || typeof row !== "object") return [];
    const url = String(row.media_path ?? row.media_url ?? "");
    const creator = creators.get(row.user_id);
    const kind = row.kind === "text" ? "text" : row.kind === "video" ? "video" : "photo";
    if (kind !== "text" && !url) return [];
    return [{
      id: row.id,
      user_id: row.user_id,
      media_url: url,
      kind,
      caption: row.caption ?? "",
      likes_count: Number(row.likes_count) || 0,
      dislikes_count: Number(row.dislikes_count) || 0,
      comments_count: Number(row.comments_count) || engagement.comments.get(row.id) || 0,
      saves_count: Number(row.saves_count) || 0,
      views_count: Number(row.views_count) || 0,
      shares_count: Number(row.shares_count) || 0,
      created_at: row.created_at ?? new Date().toISOString(),
      display_name: creator?.display_name ?? "Miembro de Cupido",
      avatar_url: creator?.avatar_url ?? "",
      is_verified_blue: Boolean(creator?.is_verified_blue),
      email: null,
      is_super_admin: Boolean(row.is_super_admin ?? creator?.is_super_admin ?? creator?.is_official),
    }];
  });

  return { posts, liked: engagement.liked, disliked: engagement.disliked, saved: engagement.saved };
}

export async function createPost(input: { userId: string; caption: string; url?: string; isVideo?: boolean; kind?: "photo" | "video" | "text" }): Promise<string> {
  const kind = input.kind ?? (input.isVideo ? "video" : "photo");
  const result = await db
    .from("cupido_posts")
    .insert({
      user_id: input.userId,
      caption: input.caption.trim(),
      media_path: input.url || null,
      kind,
    })
    .select("id")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data?.id) throw new Error("No se pudo guardar la publicación.");
  return String(result.data.id);
}

export async function togglePostLike(postId: string, liked: boolean): Promise<boolean> {
  const rpc = await db.rpc("cupido_toggle_post_like", { _post: postId });
  if (!rpc.error) return typeof rpc.data === "boolean" ? rpc.data : !liked;
  if (liked) {
    const { error } = await db.from("cupido_post_likes").delete().eq("post_id", postId).eq("user_id", (await currentUserId()) ?? "");
    if (!error) return false;
  } else {
    const userId = await currentUserId();
    if (!userId) throw new Error("Inicia sesión.");
    const { error } = await db.from("cupido_post_likes").insert({ post_id: postId, user_id: userId });
    if (!error) return true;
  }
  throw rpc.error;
}

export async function togglePostDislike(postId: string, disliked: boolean): Promise<boolean> {
  const rpc = await db.rpc("cupido_toggle_post_dislike", { _post: postId });
  if (!rpc.error) return typeof rpc.data === "boolean" ? rpc.data : !disliked;
  const userId = await currentUserId();
  if (!userId) throw new Error("Inicia sesión.");
  if (disliked) {
    const { error } = await db.from("cupido_post_dislikes").delete().eq("post_id", postId).eq("user_id", userId);
    if (!error) return false;
    throw error;
  }
  const { error } = await db.from("cupido_post_dislikes").insert({ post_id: postId, user_id: userId });
  if (error) throw error;
  return true;
}

export async function togglePostSave(postId: string, saved: boolean): Promise<boolean> {
  const rpc = await db.rpc("cupido_toggle_post_save", { _post: postId });
  if (!rpc.error) return typeof rpc.data === "boolean" ? rpc.data : !saved;
  const userId = await currentUserId();
  if (!userId) throw new Error("Inicia sesión.");
  if (saved) {
    const { error } = await db.from("cupido_post_saves").delete().eq("post_id", postId).eq("user_id", userId);
    if (!error) return false;
    throw error;
  }
  const { error } = await db.from("cupido_post_saves").insert({ post_id: postId, user_id: userId });
  if (error) throw error;
  return true;
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const result = await db
    .from("cupido_post_comments")
    .select("id,post_id,user_id,body,created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(60);
  if (result.error) return [];
  const rows = (result.data ?? []) as AnyRow[];
  const ids = [...new Set(rows.map((row) => row.user_id as string))];
  const profiles = ids.length
    ? await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").in("id", ids)
    : { data: [] };
  const map = new Map(((profiles.data ?? []) as AnyRow[]).map((row) => [row.id as string, row]));
  return rows.map((row) => {
    const profile = map.get(row.user_id);
    return {
      id: row.id,
      post_id: row.post_id,
      user_id: row.user_id,
      body: row.body,
      created_at: row.created_at,
      display_name: profile?.display_name ?? "Miembro de Cupido",
      avatar_url: profile?.avatar_url ?? "",
    };
  });
}

export async function addComment(postId: string, body: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Inicia sesión.");
  const text = body.trim().slice(0, 500);
  if (!text) throw new Error("Escribe un comentario.");
  const { error } = await db.from("cupido_post_comments").insert({ post_id: postId, user_id: userId, body: text });
  if (error) throw error;
  const owner = await db.from("cupido_posts").select("user_id").eq("id", postId).maybeSingle();
  if (owner.data?.user_id && owner.data.user_id !== userId) {
    void notifyUser({
      userId: owner.data.user_id as string,
      title: "💬 Nuevo comentario",
      body: text.slice(0, 120),
      kind: "comment",
      actorId: userId,
      targetId: postId,
    });
  }
}

export async function registerPostView(postId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const key = `cupido-view-${postId}`;
  if (window.sessionStorage.getItem(key)) return;
  window.sessionStorage.setItem(key, "1");
  await db.rpc("cupido_register_post_view", { _post: postId });
}

export async function notifyUser(input: {
  userId: string;
  title: string;
  body: string;
  kind: string;
  actorId?: string | null;
  targetId?: string | null;
}): Promise<void> {
  if (!input.userId) return;
  try {
    const preference = await db
      .from("profiles")
      .select("notifications_enabled")
      .eq("id", input.userId)
      .maybeSingle();
    if (!preference.error && preference.data?.notifications_enabled === false) return;
    const rpc = await db.rpc("cupido_create_notification", {
      p_user: input.userId,
      p_title: input.title,
      p_body: input.body,
      p_kind: input.kind,
      p_actor: input.actorId ?? null,
      p_target: input.targetId ?? null,
    });
    if (!rpc.error) return;
  } catch {
    return;
  }
  try {
    const actorId = input.actorId ?? null;
    const targetId = input.targetId ?? null;
    let existing = db
      .from("notifications")
      .select("id")
      .eq("user_id", input.userId)
      .eq("kind", input.kind)
      .eq("target_id", targetId ?? "");
    if (actorId) existing = existing.eq("actor_id", actorId);
    const found = await existing.maybeSingle();
    if (found.data) return;
    await db.from("notifications").insert({
      user_id: input.userId,
      title: input.title,
      body: input.body,
      kind: input.kind,
      actor_id: actorId,
      target_id: targetId,
    });
  } catch {
    return;
  }
}

export async function sharePost(post: FeedPost): Promise<"shared" | "copied"> {
  const url = `${window.location.origin}/?post=${encodeURIComponent(post.id)}`;
  const text = post.caption || "Mira esta publicación en Cupido Leudy ❤️";
  let result: "shared" | "copied";
  if (navigator.share) {
    try {
      await navigator.share({ title: "Cupido Leudy ❤️", text, url });
      result = "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      await navigator.clipboard.writeText(url);
      result = "copied";
    }
  } else {
    await navigator.clipboard.writeText(url);
    result = "copied";
  }
  await db.rpc("cupido_register_post_share", { _post: post.id }).catch(() => undefined);
  return result;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
