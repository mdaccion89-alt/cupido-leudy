import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cupido.leudy",
  appName: "Cupido Leudy",
  webDir: "dist",
  // Keep server.url unset so Android always loads this packaged dist bundle locally.
  server: {
    androidScheme: "https",
  },
};

export default config;
