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

export class TronRpcClient {
  constructor(private readonly config: TronRpcConfig) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<TronRpcResponse<T>> {
    const providers: Array<{ url: string; key: string; name: "primary" | "secondary" }> = [
      { url: this.config.primaryUrl, key: this.config.apiKey, name: "primary" },
    ];
    if (this.config.secondaryUrl.trim()) {
      providers.push({
        url: this.config.secondaryUrl,
        key: this.config.secondaryApiKey,
        name: "secondary",
      });
    }

    let lastError = "unknown RPC error";
    for (const provider of providers) {
      const base = normalizeBaseUrl(provider.url);
      const url = path.startsWith("http")
        ? path
        : `${base}${path.startsWith("/") ? path : `/${path}`}`;

      for (let attempt = 0; attempt < this.config.maxRetries; attempt += 1) {
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
            this.config.timeoutMs,
          );

          if (!response.ok) {
            lastError = `HTTP ${response.status} from ${provider.name}`;
            if (isRetryableStatus(response.status) && attempt + 1 < this.config.maxRetries) {
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
          if (attempt + 1 < this.config.maxRetries) {
            await sleep(2 ** attempt * 250);
            continue;
          }
        }
      }
    }

    return { ok: false, error: lastError, provider: null, retryable: true };
  }
}
