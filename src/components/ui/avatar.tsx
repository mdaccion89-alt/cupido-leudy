"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import { useIsWeeklyTopThree } from "@/components/cupido/weekly-ranking";
import { AvatarFrameOrnament } from "@/components/cupido/avatar-frame-ornament";
import { useEquippedAvatarFrame, type EquippedAvatarFrame } from "@/lib/avatar-frames";

type AvatarProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
  userId?: string | null | undefined;
  previewFrame?: EquippedAvatarFrame | null;
};
const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, userId, previewFrame, children, style, ...props }, ref) => {
  const isWeeklyTopThree = useIsWeeklyTopThree(userId);
  const equippedFrame = useEquippedAvatarFrame(userId);
  const avatarFrame = previewFrame ?? equippedFrame;
  return (
  <AvatarPrimitive.Root
    ref={ref}
    data-weekly-top-three={isWeeklyTopThree || undefined}
    data-avatar-frame={avatarFrame?.frame_id}
    data-avatar-frame-effect={avatarFrame?.effect}
    style={{ ...(style ?? {}), ...(avatarFrame ? { "--avatar-frame-a": avatarFrame.color_a, "--avatar-frame-b": avatarFrame.color_b } : {}) } as React.CSSProperties}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", avatarFrame && "cupido-avatar-frame-root overflow-visible", isWeeklyTopThree && "ring-2 ring-amber-300 ring-offset-1 ring-offset-black animate-pulse", className)}
    {...props}
  >
    {children}
    {avatarFrame && <AvatarFrameOrnament frame={avatarFrame} />}
  </AvatarPrimitive.Root>
  );
});
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("relative z-[1] aspect-square h-full w-full rounded-full", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "relative z-[1] flex h-full w-full items-center justify-center rounded-full bg-muted",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
