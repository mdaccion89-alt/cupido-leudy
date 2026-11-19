import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.leudyia.adobe",
  appName: "Leudy IA Adobe",
  webDir: "dist",
  server: {
    url: "https://onrender.com",
    cleartext: true,
  },
};

export default config;
