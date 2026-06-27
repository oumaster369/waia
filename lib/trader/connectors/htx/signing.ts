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

export function buildSignedAuthQuery(input: {
  accessKeyId: string;
  secret: string;
  host: string;
  path: string;
  method: "GET" | "POST";
  params?: HtxSignParams;
  timestamp?: string;
}): { queryString: string; signedParams: HtxSignParams } {
  const timestamp = input.timestamp ?? formatHtxTimestamp();
  const baseParams: HtxSignParams = {
    AccessKeyId: input.accessKeyId,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: timestamp,
    ...input.params,
  };

  const signature = signHtxRequest({
    method: input.method,
    host: input.host,
    path: input.path,
    params: baseParams,
    secret: input.secret,
  });

  const signedParams: HtxSignParams = {
    ...baseParams,
    Signature: signature,
  };

  return {
    queryString: buildCanonicalQuery(signedParams),
    signedParams,
  };
}

export function buildSignedQueryString(input: {
  accessKeyId: string;
  secret: string;
  host: string;
  path: string;
  params?: HtxSignParams;
  timestamp?: string;
}): string {
  return buildSignedAuthQuery({ ...input, method: "GET" }).queryString;
}

/** Auth query string for HTX v2 signed POST (business params go in JSON body). */
export function buildSignedPostQueryString(input: {
  accessKeyId: string;
  secret: string;
  host: string;
  path: string;
  timestamp?: string;
}): string {
  return buildSignedAuthQuery({ ...input, method: "POST" }).queryString;
}
