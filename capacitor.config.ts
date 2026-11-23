import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cupido.leudy",
  appName: "Cupido Leudy",
  webDir: "dist",
  // Load the published app in Capacitor's WebView so web fixes reach installed APKs on launch.
  server: {
    url: "https://leudyia.onrender.com",
    androidScheme: "https",
    allowNavigation: [
      "leudyia.onrender.com",
      "grlypsxivgxrvahnjoay.supabase.co",
      "accounts.google.com",
      "www.google.com",
    ],
  },
};

export default config;
