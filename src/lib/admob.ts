import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { AdMob, BannerAdPosition, RewardAdPluginEvents } from "@capacitor-community/admob";

export const BANNER_ID = "ca-app-pub-9590752647129001/7954788199";
export const REWARDED_ID = "ca-app-pub-9590752647129001/6042940724";

const BANNER_BOTTOM_MARGIN = 168;
const MESSAGES_BANNER_TOP_MARGIN = 144;

let initialization: Promise<void> | null = null;
let bannerShown = false;
let bannerPlacement: "messages" | "discover" | null = null;
let bannerQueue: Promise<void> = Promise.resolve();

function enqueueBannerOperation(operation: () => Promise<void>): Promise<void> {
  const next = bannerQueue.then(operation, operation);
  bannerQueue = next.catch(() => undefined);
  return bannerQueue;
}

export function isNativeAds(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function initializeAdMob(): Promise<void> {
  if (!isNativeAds()) return Promise.resolve();
  if (!initialization) {
    initialization = AdMob.initialize()
      .then(() => undefined)
      .catch(() => {
        initialization = null;
      });
  }
  return initialization;
}

export function showFeedBanner(placement: "messages" | "discover"): Promise<void> {
  if (!isNativeAds()) return Promise.resolve();
  return enqueueBannerOperation(async () => {
    if (bannerShown && bannerPlacement === placement) return;
    await initializeAdMob();
    try {
      if (bannerShown) await AdMob.removeBanner();
      await AdMob.showBanner({
        adId: BANNER_ID,
        position: placement === "messages" ? BannerAdPosition.TOP_CENTER : BannerAdPosition.BOTTOM_CENTER,
        margin: placement === "messages" ? MESSAGES_BANNER_TOP_MARGIN : BANNER_BOTTOM_MARGIN,
      });
      bannerShown = true;
      bannerPlacement = placement;
    } catch {
      bannerShown = false;
      bannerPlacement = null;
    }
  });
}

export function hideFeedBanner(): Promise<void> {
  if (!isNativeAds()) return Promise.resolve();
  return enqueueBannerOperation(async () => {
    if (!bannerShown) return;
    try {
      await AdMob.removeBanner();
    } catch {
      // Reset local state so later route transitions can retry cleanly.
    }
    bannerShown = false;
    bannerPlacement = null;
  });
}

export type RewardedAdResult = "rewarded" | "dismissed" | "unavailable";

export async function showRewardedAd(onReward: () => void | Promise<void>): Promise<RewardedAdResult> {
  if (!isNativeAds()) return "unavailable";
  await initializeAdMob();

  let listener: PluginListenerHandle | null = null;
  let granted = false;
  let grantPromise: Promise<void> | null = null;

  const grant = (): Promise<void> => {
    if (!grantPromise) {
      granted = true;
      grantPromise = Promise.resolve(onReward()).then(() => undefined);
    }
    return grantPromise;
  };

  try {
    listener = await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      void grant();
    });
    await AdMob.prepareRewardVideoAd({ adId: REWARDED_ID });
    await AdMob.showRewardVideoAd();
    if (granted && grantPromise) await grantPromise;
    return granted ? "rewarded" : "dismissed";
  } catch {
    if (granted && grantPromise) await grantPromise;
    return granted ? "rewarded" : "dismissed";
  } finally {
    if (listener) void listener.remove().catch(() => undefined);
  }
}
