import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from "@capacitor-community/admob";

export const APP_ID = "ca-app-pub-9590752647129001~4817488960";
export const BANNER_ID = "ca-app-pub-9590752647129001/7954788199";
export const INTERSTITIAL_ID = "ca-app-pub-9590752647129001/6833278215";
export const REWARDED_ID = "ca-app-pub-9590752647129001/6042940724";

const BANNER_BOTTOM_MARGIN = 168;
const INTERSTITIAL_COOLDOWN_MS = 5 * 60_000;
const INTERSTITIAL_LAST_SHOWN_KEY = "cupido-admob-interstitial-last-shown";

let initialization: Promise<boolean> | null = null;
let bannerShown = false;
let bannerPlacement: "messages" | "discover" | null = null;
let bannerQueue: Promise<void> = Promise.resolve();
let adsEnabled = true;
let interstitialInProgress = false;
let lastInterstitialShownAt = 0;

function enqueueBannerOperation(operation: () => Promise<void>): Promise<void> {
  const next = bannerQueue.then(operation, operation);
  bannerQueue = next.catch(() => undefined);
  return bannerQueue;
}

export function isNativeAds(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function setAdsEnabled(enabled: boolean): void {
  adsEnabled = enabled;
  if (!enabled) void hideFeedBanner();
}

export function areAdsEnabled(): boolean {
  return adsEnabled;
}

export function initializeAdMob(): Promise<boolean> {
  if (!isNativeAds() || !adsEnabled) return Promise.resolve(false);
  if (!initialization) {
    initialization = (async () => {
      try {
        const consent = await AdMob.requestConsentInfo();
        let mayRequestAds = consent.canRequestAds;
        if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
          const updated = await AdMob.showConsentForm();
          mayRequestAds = updated.canRequestAds;
        }
        if (!mayRequestAds || !adsEnabled) return false;
        await AdMob.initialize();
        return true;
      } catch {
        return false;
      }
    })().catch(() => false);
  }
  return initialization;
}

export function showFeedBanner(placement: "messages" | "discover"): Promise<void> {
  if (!isNativeAds() || !adsEnabled) return Promise.resolve();
  return enqueueBannerOperation(async () => {
    if (!adsEnabled) return;
    if (bannerShown && bannerPlacement === placement) return;
    const ready = await initializeAdMob();
    if (!ready || !adsEnabled) return;
    try {
      if (bannerShown) await AdMob.removeBanner();
      await AdMob.showBanner({
        adId: BANNER_ID,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: BANNER_BOTTOM_MARGIN,
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
      // Keep native plugin failures from affecting route navigation.
    }
    bannerShown = false;
    bannerPlacement = null;
  });
}

function isInterstitialSurfaceEligible(): boolean {
  if (typeof window === "undefined" || !adsEnabled) return false;
  const path = window.location.pathname.toLowerCase();
  const blockedPrefixes = ["/directo", "/live", "/tienda", "/retiro", "/withdraw", "/chat/", "/admin", "/auth"];
  if (blockedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  if (document.querySelector("[data-cupido-live-room='true'], [data-cupido-checkout='true'], [data-cupido-withdrawal='true']")) return false;
  if (document.querySelector("[role='dialog'][data-state='open']")) return false;
  return true;
}

export async function maybeShowInterstitialAd(): Promise<void> {
  if (!isNativeAds() || !adsEnabled || interstitialInProgress || !isInterstitialSurfaceEligible()) return;
  let lastShown = lastInterstitialShownAt;
  try {
    lastShown = Math.max(lastShown, Number(window.localStorage.getItem(INTERSTITIAL_LAST_SHOWN_KEY) ?? 0));
  } catch {
    // The in-memory timestamp still limits this app session if storage is blocked.
  }
  if (Date.now() - lastShown < INTERSTITIAL_COOLDOWN_MS) return;

  interstitialInProgress = true;
  try {
    const ready = await initializeAdMob();
    if (!ready || !adsEnabled || !isInterstitialSurfaceEligible()) return;
    await AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID });
    if (!adsEnabled || !isInterstitialSurfaceEligible()) return;
    await AdMob.showInterstitial({ adId: INTERSTITIAL_ID });
    lastInterstitialShownAt = Date.now();
    try {
      window.localStorage.setItem(INTERSTITIAL_LAST_SHOWN_KEY, String(lastInterstitialShownAt));
    } catch {
      // Continue with the in-memory frequency limit.
    }
  } catch {
    // A missing ad must never interrupt navigation or video playback.
  } finally {
    interstitialInProgress = false;
  }
}

export type RewardedAdResult = "rewarded" | "dismissed" | "unavailable";

export async function showRewardedAd(userId: string, sessionId: string): Promise<RewardedAdResult> {
  if (!isNativeAds() || !adsEnabled || !userId || !sessionId) return "unavailable";
  const ready = await initializeAdMob();
  if (!ready || !adsEnabled) return "unavailable";

  let listener: PluginListenerHandle | null = null;
  let rewarded = false;
  try {
    listener = await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      // This local event only tells the UI that the ad completed. Credit is issued
      // exclusively by the server after Google's signed SSV callback is verified.
      rewarded = true;
    });
    await AdMob.prepareRewardVideoAd({
      adId: REWARDED_ID,
      ssv: { userId, customData: sessionId },
    });
    await AdMob.showRewardVideoAd();
    return rewarded ? "rewarded" : "dismissed";
  } catch {
    return rewarded ? "rewarded" : "unavailable";
  } finally {
    if (listener) void listener.remove().catch(() => undefined);
  }
}
