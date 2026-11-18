import { Loader2, UserPlus, UserRoundMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFollowsCreator, useToggleFollow } from "@/lib/creator";

export function FollowButton({
  creatorId,
  size = "sm",
}: {
  creatorId: string;
  size?: "sm" | "default" | "pill";
}) {
  const { following, viewerId } = useFollowsCreator(creatorId);
  const toggle = useToggleFollow(creatorId);

  if (!creatorId || !viewerId || viewerId === creatorId) return null;

  const button = (
    <Button
      variant={following ? "glass" : "hero"}
      size={size}
      disabled={toggle.isPending}
      onClick={() =>
        toggle.mutate(following, {
          onError: () => toast.error("No se pudo actualizar el seguidor."),
        })
      }
    >
      {toggle.isPending ? (
        <Loader2 className="animate-spin" />
      ) : following ? (
        <UserRoundMinus />
      ) : (
        <UserPlus />
      )}
      {following ? "Dejar de seguir" : "Seguir"}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          {following ? "Dejar de seguir a este creador" : "Seguir a este creador"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
