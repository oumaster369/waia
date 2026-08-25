export const TRC20_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" as const;

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TRON_TX_HASH = /^[0-9a-fA-F]{64}$/;

export function tronScanAddressUrl(address: string): string | null {
  return TRON_ADDRESS.test(address) ? `https://tronscan.org/#/address/${address}` : null;
}

export function tronScanTransactionUrl(txHash: string): string | null {
  return TRON_TX_HASH.test(txHash) ? `https://tronscan.org/#/transaction/${txHash}` : null;
}

export function isValidTronAddress(address: string): boolean {
  return TRON_ADDRESS.test(address.trim());
}
