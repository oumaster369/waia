import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};

export type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

export type InfuraRpcClientConfig = {
  projectId?: string;
  apiSecret?: string;
  network?: "mainnet" | "sepolia";
  fetchImpl?: HtxFetchFn;
};

function resolveInfuraProjectId(configProjectId?: string): string | undefined {
  return configProjectId ?? process.env.AI_TRADER_INFURA_PROJECT_ID;
}

function resolveInfuraApiSecret(configApiSecret?: string): string | undefined {
  return configApiSecret ?? process.env.AI_TRADER_INFURA_API_SECRET;
}

export class InfuraRpcClient {
  private readonly projectId?: string;
  private readonly apiSecret?: string;
  private readonly network: "mainnet" | "sepolia";
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: InfuraRpcClientConfig = {}) {
    this.projectId = resolveInfuraProjectId(config.projectId);
    this.apiSecret = resolveInfuraApiSecret(config.apiSecret);
    this.network = config.network ?? "mainnet";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private resolveRpcUrl(): string {
    if (!this.projectId) {
      throw new Error("[infura] AI_TRADER_INFURA_PROJECT_ID is required");
    }
    return `https://${this.network}.infura.io/v3/${this.projectId}`;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiSecret) {
      headers.Authorization = `Basic ${Buffer.from(`:${this.apiSecret}`).toString("base64")}`;
    }

    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    };
    const response = await this.fetchImpl(this.resolveRpcUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`[infura] rpc HTTP ${response.status}`);
    }
    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(`[infura] rpc error ${payload.error.code}: ${payload.error.message}`);
    }
    if (payload.result === undefined) {
      throw new Error("[infura] rpc response missing result");
    }
    return payload.result;
  }

  async getBlockNumber(): Promise<string> {
    return this.call<string>("eth_blockNumber");
  }

  async getGasPrice(): Promise<string> {
    return this.call<string>("eth_gasPrice");
  }
}
