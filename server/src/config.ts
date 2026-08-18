export interface ServerConfig {
  host: string;
  port: number;
  apiKey: string | undefined;
  publicUrl: string;
  browserExecutablePath: string | undefined;
  maxSessions: number;
  defaultTtlSeconds: number;
  defaultIdleTimeoutSeconds: number;
  browserWarmIdleSeconds: number;
  allowEvaluate: boolean;
  allowPrivateNetwork: boolean;
  databaseUrl: string | undefined;
  cloudAuthRequired: boolean;
  cloudSessionSecret: string | undefined;
  cloudKeyPepper: string | undefined;
  cloudSessionTtlSeconds: number;
  artifactRoot: string;
  leaseRoot: string;
  workerId: string;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
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
    browserWarmIdleSeconds: nonNegativeNumberEnv("BROWSER_WARM_IDLE_SECONDS", 120),
    allowEvaluate: process.env.BROWSER_ALLOW_EVALUATE === "true",
    allowPrivateNetwork: process.env.BROWSER_ALLOW_PRIVATE_NETWORK === "true",
    databaseUrl: process.env.DATABASE_URL,
    cloudAuthRequired: process.env.CLOUD_AUTH_REQUIRED === "true",
    cloudSessionSecret: process.env.CLOUD_SESSION_SECRET,
    cloudKeyPepper: process.env.CLOUD_KEY_PEPPER,
    cloudSessionTtlSeconds: numberEnv("CLOUD_SESSION_TTL_SECONDS", 60 * 60 * 24 * 14),
    artifactRoot: process.env.BROWSER_ARTIFACT_ROOT ?? "/tmp/browser-kit-artifacts",
    leaseRoot: process.env.BROWSER_LEASE_ROOT ?? "/tmp/browser-kit-leases",
    workerId: process.env.BROWSER_WORKER_ID ?? `worker-${process.pid}`,
  };
}
