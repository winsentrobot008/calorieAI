/**
 * oauthDetect — 自动检测可用的 OAuth 登录提供商
 */
interface ProviderConfig {
  id: string;
  envVar: string;
  platforms: string[];
}

const PROVIDERS: ProviderConfig[] = [
  { id: "google", envVar: "NEXT_PUBLIC_GOOGLE_CLIENT_ID", platforms: ["ios", "android", "mac", "windows", "linux", "unknown"] },
  { id: "apple", envVar: "NEXT_PUBLIC_APPLE_CLIENT_ID", platforms: ["ios", "mac"] },
];

function getPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac OS/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "unknown";
}

export function detectProviders() {
  const platform = getPlatform();
  const available: string[] = [];

  for (const cfg of PROVIDERS) {
    if (cfg.platforms.includes(platform)) {
      available.push(cfg.id);
    }
  }

  return { available, platform };
}
