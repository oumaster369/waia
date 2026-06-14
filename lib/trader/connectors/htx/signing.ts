import { createHmac } from "node:crypto";

export type HtxSignParams = Record<string, string>;

function encodeParam(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function buildCanonicalQuery(params: HtxSignParams): string {
  return Object.keys(params)
    .sort()
    .map((key) => encodeParam(key, params[key]!))
    .join("&");
}

export function formatHtxTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}

export function signHtxRequest(input: {
  method: "GET" | "POST";
  host: string;
  path: string;
  params: HtxSignParams;
  secret: string;
}): string {
  const canonical = buildCanonicalQuery(input.params);
  const payload = `${input.method}\n${input.host}\n${input.path}\n${canonical}`;
  return createHmac("sha256", input.secret).update(payload).digest("base64");
}

export function buildSignedQueryString(input: {
  accessKeyId: string;
  secret: string;
  host: string;
  path: string;
  params?: HtxSignParams;
  timestamp?: string;
}): string {
  const timestamp = input.timestamp ?? formatHtxTimestamp();
  const baseParams: HtxSignParams = {
    AccessKeyId: input.accessKeyId,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: timestamp,
    ...input.params,
  };

  const signature = signHtxRequest({
    method: "GET",
    host: input.host,
    path: input.path,
    params: baseParams,
    secret: input.secret,
  });

  const signedParams: HtxSignParams = {
    ...baseParams,
    Signature: signature,
  };

  return buildCanonicalQuery(signedParams);
}
