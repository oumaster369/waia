import { describe, expect, it } from "vitest";

import {
  buildSignedAuthQuery,
  buildSignedPostQueryString,
  buildSignedQueryString,
  formatHtxTimestamp,
  signHtxRequest,
} from "@/lib/trader/connectors/htx/signing";

const TEST_ACCESS_KEY = "test-access-key";
const TEST_SECRET = "test-secret-key";
const TEST_HOST = "api.huobi.pro";
const TEST_TIMESTAMP = "2017-05-11T15:19:30";

describe("HTX signing (DEE-211)", () => {
  it("formats timestamps without milliseconds", () => {
    expect(formatHtxTimestamp(new Date("2017-05-11T15:19:30.123Z"))).toBe("2017-05-11T15:19:30");
  });

  it("signs GET requests deterministically", () => {
    const params = {
      AccessKeyId: TEST_ACCESS_KEY,
      SignatureMethod: "HmacSHA256",
      SignatureVersion: "2",
      Timestamp: TEST_TIMESTAMP,
    };

    const signature = signHtxRequest({
      method: "GET",
      host: TEST_HOST,
      path: "/v1/order/orders",
      params,
      secret: TEST_SECRET,
    });

    expect(signature).toBe("GGPQXkSKh8DqhaHcmHrQrzfLcF0vXzmkq/H8E+RwjAI=");

    const repeat = signHtxRequest({
      method: "GET",
      host: TEST_HOST,
      path: "/v1/order/orders",
      params,
      secret: TEST_SECRET,
    });
    expect(repeat).toBe(signature);
  });

  it("produces stable GET query string compatible with signedGet", () => {
    const query = buildSignedQueryString({
      accessKeyId: TEST_ACCESS_KEY,
      secret: TEST_SECRET,
      host: TEST_HOST,
      path: "/v1/account/accounts",
      timestamp: TEST_TIMESTAMP,
    });

    expect(query).toContain("AccessKeyId=test-access-key");
    expect(query).toContain("SignatureMethod=HmacSHA256");
    expect(query).toContain("SignatureVersion=2");
    expect(query).toContain("Timestamp=2017-05-11T15%3A19%3A30");
    expect(query).toContain("Signature=");

    const repeat = buildSignedQueryString({
      accessKeyId: TEST_ACCESS_KEY,
      secret: TEST_SECRET,
      host: TEST_HOST,
      path: "/v1/account/accounts",
      timestamp: TEST_TIMESTAMP,
    });
    expect(repeat).toBe(query);
  });

  it("signs POST auth query separately from GET", () => {
    const getAuth = buildSignedAuthQuery({
      accessKeyId: TEST_ACCESS_KEY,
      secret: TEST_SECRET,
      host: TEST_HOST,
      path: "/v1/order/orders/place",
      method: "GET",
      timestamp: TEST_TIMESTAMP,
    });
    const postAuth = buildSignedAuthQuery({
      accessKeyId: TEST_ACCESS_KEY,
      secret: TEST_SECRET,
      host: TEST_HOST,
      path: "/v1/order/orders/place",
      method: "POST",
      timestamp: TEST_TIMESTAMP,
    });

    expect(getAuth.signedParams.Signature).not.toBe(postAuth.signedParams.Signature);
    expect(
      buildSignedPostQueryString({
        accessKeyId: TEST_ACCESS_KEY,
        secret: TEST_SECRET,
        host: TEST_HOST,
        path: "/v1/order/orders/place",
        timestamp: TEST_TIMESTAMP,
      }),
    ).toBe(postAuth.queryString);
  });

  it("sorts extra GET params before signing", () => {
    const withSymbol = buildSignedQueryString({
      accessKeyId: TEST_ACCESS_KEY,
      secret: TEST_SECRET,
      host: TEST_HOST,
      path: "/v1/order/openOrders",
      params: { symbol: "btcusdt", "account-id": "100009" },
      timestamp: TEST_TIMESTAMP,
    });

    expect(withSymbol).toContain("account-id=100009");
    expect(withSymbol).toContain("symbol=btcusdt");
    expect(withSymbol.indexOf("AccessKeyId")).toBeLessThan(withSymbol.indexOf("Signature="));
  });

  it("uses POST method in signature payload", () => {
    const signature = signHtxRequest({
      method: "POST",
      host: TEST_HOST,
      path: "/v1/order/orders/place",
      params: {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: "HmacSHA256",
        SignatureVersion: "2",
        Timestamp: TEST_TIMESTAMP,
      },
      secret: TEST_SECRET,
    });

    const getSignature = signHtxRequest({
      method: "GET",
      host: TEST_HOST,
      path: "/v1/order/orders/place",
      params: {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: "HmacSHA256",
        SignatureVersion: "2",
        Timestamp: TEST_TIMESTAMP,
      },
      secret: TEST_SECRET,
    });

    expect(signature).not.toBe(getSignature);
    expect(signature).toBe("HKpPDrSyMRhRzCg7zqNaxopMoGmomWwCoKCkanqWLEQ=");
  });
});
