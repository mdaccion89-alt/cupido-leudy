import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type GroupFriend = { id: string; display_name: string };

export function GranLigaGroups({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [friendId, setFriendId] = useState("");
  const groups = useQuery({
    queryKey: ["cupido-gran-liga-groups", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_groups").select("id,name,description,created_at").eq("owner_id", userId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const friends = useQuery({
    queryKey: ["cupido-gran-liga-friends", userId],
    queryFn: async () => {
      const { data: relations, error } = await supabase.from("friend_requests").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
      if (error) throw error;
      const ids = [...new Set((relations ?? []).map((row) => row.requester_id === userId ? row.addressee_id : row.requester_id))];
      if (!ids.length) return [] as GroupFriend[];
      const profiles = await supabase.from("cupido_public_profiles").select("id,display_name").in("id", ids).order("display_name");
      if (profiles.error) throw profiles.error;
      return (profiles.data ?? []) as GroupFriend[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cupido_create_group", { _name: name.trim(), _description: description.trim() });
      if (error) throw error;
      if (!data) throw new Error("No se pudo crear el grupo.");
      return data;
    },
    onSuccess: () => {
      setName("");
      setDescription("");
      toast.success("Grupo creado.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-gran-liga-groups", userId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo crear el grupo."),
  });
  const invite = useMutation({
    mutationFn: async ({ groupId, recipientId }: { groupId: string; recipientId: string }) => {
      const { error } = await supabase.rpc("cupido_invite_group_friend", { _group: groupId, _invitee: recipientId });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Invitación de grupo enviada."),
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo invitar a tu amigo."),
  });

  return (
    <section className="space-y-4 rounded-3xl border border-amber-300/25 bg-amber-400/[0.05] p-5">
      <h2 className="flex items-center gap-2 font-display text-xl text-amber-100"><Users className="size-5" /> Grupos Gran Liga</h2>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Nombre del grupo" aria-label="Nombre del grupo" />
        <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Descripción opcional" aria-label="Descripción del grupo" />
        <Button onClick={() => create.mutate()} disabled={create.isPending || name.trim().length < 2}><Plus className="mr-1 size-4" />Crear grupo</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={friendId} onValueChange={setFriendId}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Elige un amigo para invitar" /></SelectTrigger>
          <SelectContent>{(friends.data ?? []).map((friend) => <SelectItem key={friend.id} value={friend.id}>{friend.display_name}</SelectItem>)}</SelectContent>
        </Select>
        {!friends.data?.length && <p className="self-center text-xs text-muted-foreground">Agrega amigos para poder invitarlos a un grupo.</p>}
      </div>
      {groups.isLoading ? <p className="text-sm text-muted-foreground">Cargando tus grupos…</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(groups.data ?? []).map((group) => (
          <article key={group.id} className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="min-w-0"><p className="truncate font-semibold text-white">{group.name}</p><p className="truncate text-xs text-muted-foreground">{group.description || "Grupo privado"}</p></div>
            <Button size="sm" variant="outline" disabled={!friendId || invite.isPending} onClick={() => invite.mutate({ groupId: group.id, recipientId: friendId })}>Invitar</Button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CupidoGroupInvites({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const invites = useQuery({
    queryKey: ["cupido-group-invites", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_group_invites").select("id,group_id,status").eq("invitee_id", userId).eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      if (!rows.length) return [] as Array<{ id: string; group_id: string; group_name: string }>;
      const groupsResult = await supabase.from("cupido_groups").select("id,name").in("id", rows.map((row) => row.group_id));
      if (groupsResult.error) throw groupsResult.error;
      const names = new Map((groupsResult.data ?? []).map((group) => [group.id, group.name]));
      return rows.map((row) => ({ ...row, group_name: names.get(row.group_id) ?? "Grupo de Cupido" }));
    },
  });
  const respond = useMutation({
    mutationFn: async ({ inviteId, accept }: { inviteId: string; accept: boolean }) => {
      const { error } = await supabase.rpc("cupido_respond_group_invite", { _invite: inviteId, _accept: accept });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast.success(variables.accept ? "Te uniste al grupo." : "Invitación rechazada.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-group-invites", userId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo responder a la invitación."),
  });
  if (!invites.data?.length) return null;
  return (
    <section className="space-y-3 rounded-3xl border border-pink-300/20 bg-pink-500/[0.04] p-5">
      <h2 className="font-display text-lg text-white">Invitaciones a grupos</h2>
      {invites.data.map((invite) => (
        <div key={invite.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-sm text-white">Te invitaron a <strong>{invite.group_name}</strong></p>
          <div className="flex gap-2">
            <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ inviteId: invite.id, accept: true })}>Aceptar</Button>
            <Button size="sm" variant="outline" disabled={respond.isPending} onClick={() => respond.mutate({ inviteId: invite.id, accept: false })}>Rechazar</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
