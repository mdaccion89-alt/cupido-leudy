import { supabase } from "@/integrations/supabase/client";

export const SUPREME_ADMIN_EMAIL = "leudyfeliz81@gmail.com";

export type FeedPost = {
  id: string;
  user_id: string;
  media_url: string;
  kind: "photo" | "video" | "text";
  caption: string;
  title: string;
  is_pinned: boolean;
  shared_post_id: string | null;
  shared_post: { id: string; user_id: string; title: string; caption: string; media_url: string; kind: "photo" | "video" | "text"; display_name: string; avatar_url: string } | null;
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
  parent_comment_id: string | null;
  display_name: string;
  avatar_url: string;
  likes_count: number;
  liked: boolean;
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
  title?: any;
  is_pinned?: any;
  shared_post_id?: any;
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
  parent_comment_id?: any;
  comment_id?: any;
};

type AnyQueryClient = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
};

const db = supabase as unknown as AnyQueryClient;

const POST_COLUMNS = "id,user_id,media_path,kind,caption,title,is_pinned,shared_post_id,likes_count,dislikes_count,comments_count,saves_count,views_count,shares_count,created_at";

export function isSupremePost(email?: string | null, isSuperAdmin?: boolean | null): boolean {
  return Boolean(isSuperAdmin) || email?.toLowerCase() === SUPREME_ADMIN_EMAIL;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.floor(value)));
}

function numericHash(value: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashInRange(id?: string | null, min = 0, max = 0, salt = 0): number {
  const low = Math.floor(min);
  const high = Math.floor(max);
  if (high < low) return low;
  return low + (numericHash(String(id ?? ""), salt) % (high - low + 1));
}

export function displayedMetrics(post?: FeedPost | null): { likes: string; views: string } {
  const realLikes = Math.max(0, Number(post?.likes_count) || 0);
  const realViews = Math.max(0, Number(post?.views_count) || 0);
  if (!post?.is_super_admin) return { likes: formatCount(realLikes), views: formatCount(realViews) };
  return {
    likes: formatCount(realLikes + hashInRange(post.id, 14_200, 68_900)),
    views: formatCount(realViews + hashInRange(post.id, 78_400, 342_900, 0x9e3779b9)),
  };
}

async function savedPostIds(viewerId: string | null, postIds?: string[]): Promise<string[]> {
  if (!viewerId) return [];
  let query = db.from("cupido_saved_posts").select("post_id").eq("user_id", viewerId);
  if (postIds?.length) query = query.in("post_id", postIds);
  const saved = await query;
  if (!saved.error) return ((saved.data ?? []) as AnyRow[]).map((row) => String(row.post_id));

  let fallback = db.from("cupido_post_saves").select("post_id").eq("user_id", viewerId);
  if (postIds?.length) fallback = fallback.in("post_id", postIds);
  const legacy = await fallback;
  return ((legacy.data ?? []) as AnyRow[]).map((row) => String(row.post_id));
}

async function selectPosts(
  limit: number,
  onlyUserId?: string | null,
  savedOnly = false,
  viewerId?: string | null,
  onlyUserIds?: string[] | null,
  searchTerm?: string,
  onlyPostId?: string | null,
  likedOnly = false,
) {
  if (onlyUserIds && onlyUserIds.length === 0) return [];
  let savedIds: string[] | null = null;
  if (savedOnly) {
    if (!viewerId) return [];
    savedIds = await savedPostIds(viewerId);
    if (!savedIds.length) return [];
  }
  let likedIds: string[] | null = null;
  if (likedOnly) {
    if (!viewerId) return [];
    const { data, error } = await db.from("cupido_post_likes").select("post_id").eq("user_id", viewerId);
    if (error) throw error;
    likedIds = ((data ?? []) as AnyRow[]).map((row) => String(row.post_id));
    if (!likedIds.length) return [];
  }

  let query = db.from("cupido_posts").select(POST_COLUMNS).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  if (onlyUserId) query = query.eq("user_id", onlyUserId);
  if (onlyPostId) query = query.eq("id", onlyPostId);
  if (onlyUserIds) query = query.in("user_id", onlyUserIds);
  if (savedIds) query = query.in("id", savedIds);
  if (likedIds) query = query.in("id", likedIds);
  if (searchTerm?.trim()) query = query.ilike("caption", `%${searchTerm.trim().replace(/[%_]/g, "\\$&")}%`);
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
    savedPostIds(viewerId, postIds),
    db.from("cupido_post_comments").select("post_id").in("post_id", postIds),
  ]);
  const commentCounts = new Map<string, number>();
  for (const row of (comments.data ?? []) as AnyRow[]) {
    commentCounts.set(row.post_id, (commentCounts.get(row.post_id) ?? 0) + 1);
  }
  return {
    liked: new Set(((likes.data ?? []) as AnyRow[]).map((row) => row.post_id as string)),
    disliked: new Set(((dislikes.data ?? []) as AnyRow[]).map((row) => row.post_id as string)),
    saved: new Set(saves),
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
  searchTerm?: string | undefined;
  onlyPostId?: string | null | undefined;
  likedOnly?: boolean;
}): Promise<FeedResult> {
  const { viewerId = null, limit = 24, videoOnly = false, onlyUserId = null, savedOnly = false, likedOnly = false, followingOnly = false, searchTerm, onlyPostId = null } = options;
  if (followingOnly && !viewerId) {
    return { posts: [], liked: new Set(), disliked: new Set(), saved: new Set() };
  }
  let followedIds: string[] | null = null;
  if (followingOnly && viewerId) {
    const { data, error } = await db.from("follows").select("following_id").eq("follower_id", viewerId);
    if (error) throw error;
    followedIds = ((data ?? []) as AnyRow[]).map((row) => String(row.following_id));
  }
  const rows = await selectPosts(limit, onlyUserId, savedOnly, viewerId, followedIds, searchTerm, onlyPostId, likedOnly);
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
  const sharedIds = [...new Set(filtered.map((row) => row.shared_post_id).filter((id): id is string => typeof id === "string"))];
  const sharedRows = sharedIds.length
    ? await db.from("cupido_posts").select("id,user_id,media_path,kind,caption,title").in("id", sharedIds)
    : { data: [], error: null };
  if (sharedRows.error) throw sharedRows.error;
  const sharedCreators = [...new Set(((sharedRows.data ?? []) as AnyRow[]).map((row) => row.user_id as string))];
  const sharedProfiles = sharedCreators.length
    ? await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").in("id", sharedCreators)
    : { data: [], error: null };
  if (sharedProfiles.error) throw sharedProfiles.error;
  const sharedProfileMap = new Map(((sharedProfiles.data ?? []) as AnyRow[]).map((row) => [row.id as string, row]));
  const sharedMap = new Map(((sharedRows.data ?? []) as AnyRow[]).map((row) => {
    const profile = sharedProfileMap.get(row.user_id);
    return [row.id as string, {
      id: String(row.id), user_id: String(row.user_id), title: String(row.title ?? ""), caption: String(row.caption ?? ""),
      media_url: String(row.media_path ?? ""), kind: row.kind === "video" ? "video" as const : row.kind === "text" ? "text" as const : "photo" as const,
      display_name: String(profile?.display_name ?? "Miembro de Cupido"), avatar_url: String(profile?.avatar_url ?? ""),
    }];
  }));
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
      title: String(row.title ?? ""),
      is_pinned: Boolean(row.is_pinned),
      shared_post_id: typeof row.shared_post_id === "string" ? row.shared_post_id : null,
      shared_post: typeof row.shared_post_id === "string" ? sharedMap.get(row.shared_post_id) ?? null : null,
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
      is_super_admin: Boolean(row.is_super_admin ?? creator?.is_super_admin ?? creator?.["is_official"]),
    }];
  });

  return { posts, liked: engagement.liked, disliked: engagement.disliked, saved: engagement.saved };
}

export async function createPost(input: { userId: string; caption: string; title?: string; url?: string; isVideo?: boolean; kind?: "photo" | "video" | "text"; sharedPostId?: string }): Promise<string> {
  const kind = input.kind ?? (input.isVideo ? "video" : "photo");
  const result = await db
    .from("cupido_posts")
    .insert({
      user_id: input.userId,
      caption: input.caption.trim(),
      title: input.title?.trim() || null,
      shared_post_id: input.sharedPostId ?? null,
      media_path: input.url || null,
      kind,
    })
    .select("id")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data?.id) throw new Error("No se pudo guardar la publicación.");
  return String(result.data.id);
}

export async function updatePost(postId: string, title: string, caption: string): Promise<void> {
  const { error } = await db.from("cupido_posts").update({ title: title.trim() || null, caption: caption.trim() }).eq("id", postId);
  if (error) throw error;
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await db.from("cupido_posts").delete().eq("id", postId);
  if (error) throw error;
}

export async function togglePostPinned(postId: string, pinned: boolean): Promise<void> {
  const { error } = await db.from("cupido_posts").update({ is_pinned: !pinned }).eq("id", postId);
  if (error) throw error;
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
    const { error } = await db.from("cupido_saved_posts").delete().eq("post_id", postId).eq("user_id", userId);
    if (!error) return false;
    throw error;
  }
  const { error } = await db.from("cupido_saved_posts").insert({ post_id: postId, user_id: userId });
  if (error) throw error;
  void db.from("cupido_post_saves").insert({ post_id: postId, user_id: userId }).then(() => undefined);
  return true;
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const viewerId = await currentUserId();
  const result = await db
    .from("cupido_post_comments")
    .select("id,post_id,user_id,body,created_at,parent_comment_id")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(60);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as AnyRow[];
  const ids = [...new Set(rows.map((row) => row.user_id as string))];
  const commentIds = rows.map((row) => String(row.id));
  const likesResult = commentIds.length
    ? await db.from("cupido_comment_likes").select("comment_id,user_id").in("comment_id", commentIds)
    : { data: [], error: null };
  if (likesResult.error) throw likesResult.error;
  const likes = (likesResult.data ?? []) as AnyRow[];
  const likeCounts = new Map<string, number>();
  const likedIds = new Set<string>();
  for (const like of likes) {
    const commentId = String(like.comment_id);
    likeCounts.set(commentId, (likeCounts.get(commentId) ?? 0) + 1);
    if (like.user_id === viewerId) likedIds.add(commentId);
  }
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
      parent_comment_id: typeof row.parent_comment_id === "string" ? row.parent_comment_id : null,
      display_name: profile?.display_name ?? "Miembro de Cupido",
      avatar_url: profile?.avatar_url ?? "",
      likes_count: likeCounts.get(String(row.id)) ?? 0,
      liked: likedIds.has(String(row.id)),
    };
  });
}

export async function addComment(postId: string, body: string, parentCommentId: string | null = null): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Inicia sesión.");
  const text = body.trim().slice(0, 500);
  if (!text) throw new Error("Escribe un comentario.");
  const { error } = await db.from("cupido_post_comments").insert({
    post_id: postId,
    user_id: userId,
    body: text,
    parent_comment_id: parentCommentId,
  });
  if (error) throw error;
}

export async function toggleCommentLike(commentId: string): Promise<void> {
  const result = await db.rpc("cupido_toggle_comment_like", { _comment: commentId });
  if (result.error) throw result.error;
}

export async function reportComment(commentId: string, reason = "Comentario ofensivo o spam"): Promise<void> {
  const result = await db.rpc("cupido_report_comment", { _comment: commentId, _reason: reason });
  if (result.error) throw result.error;
}

export async function registerPostView(postId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const userId = await currentUserId();
  if (!userId) return;
  const key = `cupido-view-${postId}`;
  if (window.sessionStorage.getItem(key)) return;
  const result = await db.rpc("cupido_register_post_view", { _post: postId });
  if (result.error) throw result.error;
  window.sessionStorage.setItem(key, "1");
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
  const url = `${window.location.origin}/muro?post=${encodeURIComponent(post.id)}`;
  const text = post.caption || "Mira esta publicación en Cupido Leudy ❤️";
  const copyUrl = async () => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return;
      } catch {
        // Use the selection based fallback below when clipboard permission is unavailable.
      }
    }
    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("No se pudo copiar el enlace de la publicación.");
  };
  let result: "shared" | "copied";
  if (navigator.share) {
    try {
      await navigator.share({ title: "Cupido Leudy ❤️", text, url });
      result = "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      await copyUrl();
      result = "copied";
    }
  } else {
    await copyUrl();
    result = "copied";
  }
  const viewerId = await currentUserId();
  if (viewerId) {
    const countResult = await db.rpc("cupido_register_post_share", { _post: post.id });
    if (countResult.error) throw countResult.error;
  }
  return result;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
