import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { AdMob, BannerAdPosition, RewardAdPluginEvents } from "@capacitor-community/admob";

export const BANNER_ID = "ca-app-pub-9590752647129001/7954788199";
export const INTERSTITIAL_ID = "ca-app-pub-9590752647129001/6833278215";
export const REWARDED_ID = "ca-app-pub-9590752647129001/6042940724";

const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;
const BANNER_BOTTOM_MARGIN = 96;

let initialization: Promise<void> | null = null;
let bannerShown = false;
let interstitialLoad: Promise<boolean> | null = null;
let interstitialReady = false;
let lastInterstitialAt = 0;

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

export async function showFeedBanner(): Promise<void> {
  if (!isNativeAds() || bannerShown) return;
  await initializeAdMob();
  try {
    await AdMob.showBanner({
      adId: BANNER_ID,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: BANNER_BOTTOM_MARGIN,
    });
    bannerShown = true;
  } catch {
    bannerShown = false;
  }
}

export async function hideFeedBanner(): Promise<void> {
  if (!isNativeAds() || !bannerShown) return;
  try {
    await AdMob.removeBanner();
    bannerShown = false;
  } catch {
    bannerShown = false;
  }
}

function loadInterstitial(): Promise<boolean> {
  if (!isNativeAds()) return Promise.resolve(false);
  if (interstitialReady) return Promise.resolve(true);
  if (!interstitialLoad) {
    interstitialLoad = initializeAdMob()
      .then(() => AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID }))
      .then(() => {
        interstitialReady = true;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        interstitialLoad = null;
      });
  }
  return interstitialLoad;
}

export async function showInterstitialAd(): Promise<boolean> {
  if (!isNativeAds()) return false;
  const now = Date.now();
  if (now - lastInterstitialAt < INTERSTITIAL_COOLDOWN_MS) return false;
  const ready = await loadInterstitial();
  if (!ready) return false;
  try {
    await AdMob.showInterstitial();
    lastInterstitialAt = Date.now();
    interstitialReady = false;
    void loadInterstitial();
    return true;
  } catch {
    interstitialReady = false;
    return false;
  }
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
    await grant();
    return "rewarded";
  } catch {
    if (granted && grantPromise) await grantPromise;
    return granted ? "rewarded" : "dismissed";
  } finally {
    if (listener) void listener.remove().catch(() => undefined);
  }
}
