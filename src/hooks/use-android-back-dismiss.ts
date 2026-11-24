import { useEffect, useRef } from "react";

/** Closes a transient mobile panel on Android/browser back without navigating away. */
export function useAndroidBackDismiss(open: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const marker = `__cupido_overlay_${Math.random().toString(36).slice(2)}`;
    const state = window.history.state && typeof window.history.state === "object"
      ? window.history.state as Record<string, unknown>
      : {};
    let dismissedByPopstate = false;

    window.history.pushState({ ...state, [marker]: true }, "", window.location.href);
    const handlePopState = () => {
      dismissedByPopstate = true;
      onBackRef.current();
    };
    const handleNativeBack = (event: Event) => {
      event.preventDefault();
      onBackRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("cupido:android-back", handleNativeBack);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("cupido:android-back", handleNativeBack);
      const currentState = window.history.state;
      if (!dismissedByPopstate && currentState && typeof currentState === "object" && marker in currentState) {
        window.history.back();
      }
    };
  }, [open]);
}
