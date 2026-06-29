export type TronRpcConfig = {
  primaryUrl: string;
  secondaryUrl: string;
  apiKey: string;
  secondaryApiKey: string;
  maxRetries: number;
  timeoutMs: number;
};

export type TronRpcResponse<T> =
  | { ok: true; data: T; provider: "primary" | "secondary" }
  | { ok: false; error: string; provider: "primary" | "secondary" | null; retryable: boolean };

export type TronRpcClient = {
  request<T>(path: string, init?: RequestInit): Promise<TronRpcResponse<T>>;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["TRON-PRO-API-KEY"] = apiKey;
  }
  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Factory avoids class constructor interop issues in Cloudflare Worker cron bundles. */
export function createTronRpcClient(config: TronRpcConfig): TronRpcClient {
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<TronRpcResponse<T>> {
      const providers: Array<{ url: string; key: string; name: "primary" | "secondary" }> = [
        { url: config.primaryUrl, key: config.apiKey, name: "primary" },
      ];
      if (config.secondaryUrl.trim()) {
        providers.push({
          url: config.secondaryUrl,
          key: config.secondaryApiKey,
          name: "secondary",
        });
      }

      let lastError = "unknown RPC error";
      for (const provider of providers) {
        const base = normalizeBaseUrl(provider.url);
        const url = path.startsWith("http")
          ? path
          : `${base}${path.startsWith("/") ? path : `/${path}`}`;

        for (let attempt = 0; attempt < config.maxRetries; attempt += 1) {
          try {
            const response = await fetchWithTimeout(
              url,
              {
                ...init,
                headers: {
                  ...buildHeaders(provider.key),
                  ...(init.headers as Record<string, string> | undefined),
                },
              },
              config.timeoutMs,
            );

            if (!response.ok) {
              lastError = `HTTP ${response.status} from ${provider.name}`;
              if (isRetryableStatus(response.status) && attempt + 1 < config.maxRetries) {
                await sleep(2 ** attempt * 250);
                continue;
              }
              if (isRetryableStatus(response.status)) {
                break;
              }
              return { ok: false, error: lastError, provider: provider.name, retryable: false };
            }

            const data = (await response.json()) as T;
            return { ok: true, data, provider: provider.name };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            if (attempt + 1 < config.maxRetries) {
              await sleep(2 ** attempt * 250);
              continue;
            }
          }
        }
      }

      return { ok: false, error: lastError, provider: null, retryable: true };
    },
  };
}
