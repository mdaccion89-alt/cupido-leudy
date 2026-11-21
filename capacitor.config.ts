import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cupidoleudy.app",
  appName: "Cupido Leudy",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
