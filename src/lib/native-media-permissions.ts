import { Capacitor, registerPlugin } from "@capacitor/core";

type AndroidMediaPermissionResult = {
  camera: boolean;
  microphone: boolean;
};

type AndroidMediaPermissionsPlugin = {
  request(options?: { camera?: boolean; microphone?: boolean }): Promise<AndroidMediaPermissionResult>;
};

const androidMediaPermissions = registerPlugin<AndroidMediaPermissionsPlugin>("AndroidMediaPermissions");

export async function requestNativeMediaPermissions(options: { camera?: boolean; microphone?: boolean } = {}): Promise<void> {
  const cameraRequired = options.camera ?? true;
  const microphoneRequired = options.microphone ?? true;
  if (!cameraRequired && !microphoneRequired) return;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

  let result: AndroidMediaPermissionResult;
  try {
    result = await androidMediaPermissions.request({ camera: cameraRequired, microphone: microphoneRequired });
  } catch {
    throw new Error("ANDROID_MEDIA_PERMISSION_UNAVAILABLE");
  }

  if ((cameraRequired && !result.camera) || (microphoneRequired && !result.microphone)) {
    throw new Error("ANDROID_MEDIA_PERMISSION_DENIED");
  }
}

export function mediaPermissionMessage(error: unknown): string | null {
  const code = error instanceof Error ? error.message : "";
  if (code === "ANDROID_MEDIA_PERMISSION_DENIED") {
    return "Denegaste el acceso a la cámara o al micrófono. Actívalos en Ajustes de Android y vuelve a intentarlo.";
  }
  if (code === "ANDROID_MEDIA_PERMISSION_UNAVAILABLE") {
    return "No se pudieron solicitar los permisos nativos. Revisa los permisos de Cupido Leudy en Ajustes de Android.";
  }
  const errorName = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError" || /permission denied/i.test(code)) {
    return "Android denegó el acceso a la cámara o al micrófono. Actívalos en Ajustes de Cupido Leudy y vuelve a intentarlo.";
  }
  return null;
}
