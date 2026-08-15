export interface ServerConfig {
  host: string;
  port: number;
  apiKey: string | undefined;
  publicUrl: string;
  browserExecutablePath: string | undefined;
  maxSessions: number;
  defaultTtlSeconds: number;
  defaultIdleTimeoutSeconds: number;
  allowEvaluate: boolean;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: numberEnv("PORT", 10000),
    apiKey: process.env.BROWSER_KIT_API_KEY,
    publicUrl: process.env.BROWSER_KIT_PUBLIC_URL ?? "http://localhost:10000",
    browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH,
    maxSessions: numberEnv("BROWSER_MAX_SESSIONS", 4),
    defaultTtlSeconds: numberEnv("BROWSER_DEFAULT_TTL_SECONDS", 1800),
    defaultIdleTimeoutSeconds: numberEnv("BROWSER_DEFAULT_IDLE_TIMEOUT_SECONDS", 300),
    allowEvaluate: process.env.BROWSER_ALLOW_EVALUATE === "true",
  };
}
