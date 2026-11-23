"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import { useIsWeeklyTopThree } from "@/components/cupido/weekly-ranking";

type AvatarProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { userId?: string | null | undefined };
const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, userId, ...props }, ref) => {
  const isWeeklyTopThree = useIsWeeklyTopThree(userId);
  return (
  <AvatarPrimitive.Root
    ref={ref}
    data-weekly-top-three={isWeeklyTopThree || undefined}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", isWeeklyTopThree && "ring-2 ring-amber-300 ring-offset-1 ring-offset-black animate-pulse", className)}
    {...props}
  />
  );
});
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
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
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
