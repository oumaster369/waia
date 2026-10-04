import { describe, expect, it } from "vitest";
import {
  createProjectionRequest,
  createProjectionResponse,
  PROJECTION_PATHS,
  PROJECTION_PROTOCOL_LIMITS,
  verifyProjectionRequest,
  verifyProjectionResponse,
  type ProjectionOperation,
  type ProjectionTuple,
  type SignedProjectionRequest,
  type VerifiedProjectionRequest,
} from "@/lib/trader/account-observation/projection-protocol";
import { observation, binding } from "./account-observation-stream-fixtures";

const now = 1_800_000_000_000;
const tuple: ProjectionTuple = {
  audience: "https://observation-reader.waia.life",
  releaseSha: "a".repeat(40),
  epochId: "11111111-1111-4111-8111-111111111111",
  keyId: "waia-observation-v1",
};
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const scope = {
  organizationId: binding.organizationId,
  credentialId: binding.credentialId,
  exchangeAccountId: binding.exchangeAccountId,
};
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const config = (
  clock: () => number = () => now,
  expectedTuple: ProjectionTuple = tuple,
  keyBytes = key,
) => ({ expectedTuple, keyBytes, clock });

async function makeRequest(
  operation: ProjectionOperation = "readLatest",
  payload: unknown = binding,
  id = requestId,
  issuedAtMs = now,
  deadlineMs = now + 4_000,
  requestTuple: ProjectionTuple = tuple,
): Promise<SignedProjectionRequest> {
  return createProjectionRequest(
    { operation, tuple: requestTuple, requestId: id, issuedAtMs, deadlineMs, payload },
    key,
  );
}
async function verifyRequest(request: SignedProjectionRequest, verificationConfig = config()) {
  return verifyProjectionRequest(
    { method: request.method, path: request.path, headers: request.headers, body: request.body },
    verificationConfig,
  );
}
const tupleWith = (delta: Partial<ProjectionTuple>): ProjectionTuple => ({ ...tuple, ...delta });

describe("DEE-1234 fixed projection protocol", () => {
  it("round trips both fixed operations through existing strict parsers", async () => {
    const bindReq = await makeRequest("resolveBinding", scope);
    expect(bindReq.path).toBe(PROJECTION_PATHS.resolveBinding);
    const bindContext = await verifyRequest(bindReq);
    const bindResponse = await createProjectionResponse(bindContext, binding, key);
    expect(await verifyProjectionResponse(bindResponse, bindContext, config())).toEqual(binding);

    const readReq = await makeRequest();
    expect(readReq.path).toBe(PROJECTION_PATHS.readLatest);
    const readContext = await verifyRequest(readReq);
    const snapshot = observation();
    const response = await createProjectionResponse(readContext, snapshot, key);
    expect(await verifyProjectionResponse(response, readContext, config())).toEqual(snapshot);
    expect(
      await verifyProjectionResponse(
        await createProjectionResponse(readContext, null, key),
        readContext,
        config(),
      ),
    ).toBeNull();
  });

  it("rejects any audience, release, epoch or key ID drift", async () => {
    const variants: Partial<ProjectionTuple>[] = [
      { audience: "https://other.waia.life" },
      { releaseSha: "b".repeat(40) },
      { epochId: "22222222-2222-4222-8222-222222222222" },
      { keyId: "next-key" },
    ];
    for (const change of variants) {
      const request = await makeRequest(
        "readLatest",
        binding,
        requestId,
        now,
        now + 4_000,
        tupleWith(change),
      );
      await expect(verifyRequest(request)).rejects.toThrow("PROJECTION_TUPLE_MISMATCH");
    }
    const context = await verifyRequest(await makeRequest());
    const response = await createProjectionResponse(context, observation(), key);
    const body = JSON.parse(response.body);
    body.tuple.epochId = "22222222-2222-4222-8222-222222222222";
    await expect(
      verifyProjectionResponse({ ...response, body: JSON.stringify(body) }, context, config()),
    ).rejects.toThrow();
  });

  it("validates exact HTTPS origin and tuple syntax without DNS", async () => {
    const invalid = [
      tupleWith({ audience: "http://observation-reader.waia.life" }),
      tupleWith({ audience: "https://user@observation-reader.waia.life" }),
      tupleWith({ audience: "https://observation-reader.waia.life/path" }),
      tupleWith({ audience: "https://observation-reader.waia.life?x=1" }),
      tupleWith({ releaseSha: "A".repeat(40) }),
      tupleWith({ releaseSha: "a".repeat(39) }),
      tupleWith({ epochId: "not-an-epoch" }),
      tupleWith({ keyId: "bad key id" }),
      { ...tuple, extra: "unknown" } as ProjectionTuple,
    ];
    const request = await makeRequest();
    for (const expectedTuple of invalid) {
      await expect(
        verifyProjectionRequest(
          {
            method: request.method,
            path: request.path,
            headers: request.headers,
            body: request.body,
          },
          config(() => now, expectedTuple),
        ),
      ).rejects.toThrow();
    }
  });

  it("uses repository schemas to refuse malformed scope, revisions and extra binding fields", async () => {
    await expect(makeRequest("resolveBinding", { ...scope, extra: true })).rejects.toThrow();
    await expect(
      makeRequest("resolveBinding", { ...scope, organizationId: "bad" }),
    ).rejects.toThrow();
    await expect(
      makeRequest("readLatest", { ...binding, credentialRevision: "0" }),
    ).rejects.toThrow();
    await expect(
      makeRequest("readLatest", { ...binding, configurationRevision: "" }),
    ).rejects.toThrow();
    await expect(makeRequest("readLatest", { ...binding, extra: true })).rejects.toThrow();
    const request = await makeRequest();
    const malformed = request.body.replace(
      '"exchangeAccountId":"account-a"',
      '"exchangeAccountId":""',
    );
    await expect(
      verifyProjectionRequest({ ...request, body: malformed }, config()),
    ).rejects.toThrow("PROJECTION_BINDING_INVALID");

    const changedScope = request.body.replace(
      binding.organizationId,
      "99999999-9999-4999-8999-999999999999",
    );
    await expect(
      verifyProjectionRequest({ ...request, body: changedScope }, config()),
    ).rejects.toThrow("PROJECTION_SIGNATURE_INVALID");
    const changedRevision = request.body.replace(
      '"credentialRevision":"1"',
      '"credentialRevision":"2"',
    );
    await expect(
      verifyProjectionRequest({ ...request, body: changedRevision }, config()),
    ).rejects.toThrow("PROJECTION_SIGNATURE_INVALID");
  });

  it("binds response data to exact request scope and revisions", async () => {
    const readContext = await verifyRequest(await makeRequest());
    await expect(
      createProjectionResponse(
        readContext,
        { ...observation(), binding: { ...binding, credentialRevision: "2" } },
        key,
      ),
    ).rejects.toThrow("PROJECTION_RESPONSE_BINDING");
    const bindContext = await verifyRequest(await makeRequest("resolveBinding", scope));
    await expect(
      createProjectionResponse(bindContext, { ...binding, exchangeAccountId: "different" }, key),
    ).rejects.toThrow("PROJECTION_RESPONSE_BINDING");
  });

  it("binds a response to the original request ID, operation, scope and body digest", async () => {
    const first = await verifyRequest(await makeRequest("readLatest", binding, requestId));
    const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const second = await verifyRequest(await makeRequest("readLatest", binding, otherId));
    const response = await createProjectionResponse(second, observation(), key);
    await expect(verifyProjectionResponse(response, first, config())).rejects.toThrow(
      "PROJECTION_RESPONSE_IDENTITY",
    );

    const resolve = await verifyRequest(await makeRequest("resolveBinding", scope, otherId));
    const bindingResponse = await createProjectionResponse(resolve, binding, key);
    await expect(verifyProjectionResponse(bindingResponse, first, config())).rejects.toThrow(
      "PROJECTION_RESPONSE_IDENTITY",
    );
  });

  it("rejects wrong method/path/status, duplicate security headers and unknown wrapper fields", async () => {
    const request = await makeRequest();
    await expect(
      verifyRequest(
        request,
        config(() => now, tuple, new Uint8Array(31)),
      ),
    ).rejects.toThrow("PROJECTION_KEY_LENGTH");
    await expect(
      verifyProjectionRequest(
        {
          method: "POST",
          path: request.path,
          headers: [["x-waia-projection-signature", "z".repeat(64)]],
          body: request.body,
        },
        config(),
      ),
    ).rejects.toThrow("PROJECTION_SIGNATURE_HEADER");
    await expect(
      verifyProjectionRequest(
        { method: "POST", path: request.path, headers: [["x-extra", "x"]], body: request.body },
        config(),
      ),
    ).rejects.toThrow("PROJECTION_SIGNATURE_HEADER");
    await expect(
      verifyProjectionRequest(
        { method: "GET", path: request.path, headers: request.headers, body: request.body },
        config(),
      ),
    ).rejects.toThrow();
    await expect(
      verifyProjectionRequest(
        {
          method: "POST",
          path: request.path + "?x=1",
          headers: request.headers,
          body: request.body,
        },
        config(),
      ),
    ).rejects.toThrow();
    await expect(
      verifyProjectionRequest(
        {
          method: "POST",
          path: request.path,
          headers: [...request.headers, ...request.headers],
          body: request.body,
        },
        config(),
      ),
    ).rejects.toThrow();
    await expect(
      verifyProjectionRequest(
        {
          method: "POST",
          path: request.path,
          headers: request.headers,
          body: request.body,
          extra: true,
        },
        config(),
      ),
    ).rejects.toThrow("PROJECTION_REQUEST_INPUT_FIELDS");
    const context = await verifyRequest(request);
    const response = await createProjectionResponse(context, observation(), key);
    await expect(
      verifyProjectionResponse({ ...response, status: 500 }, context, config()),
    ).rejects.toThrow("PROJECTION_RESPONSE_STATUS_OR_LATE");
    await expect(
      verifyProjectionResponse(
        { ...response, headers: [...response.headers, ...response.headers] },
        context,
        config(),
      ),
    ).rejects.toThrow();
    await expect(
      verifyProjectionResponse({ ...response, extra: true }, context, config()),
    ).rejects.toThrow("PROJECTION_RESPONSE_INPUT_FIELDS");
  });

  it("rejects duplicate JSON keys, unknown body fields, noncanonical bytes and oversized messages", async () => {
    const request = await makeRequest();
    for (const body of [
      request.body.replace("{", '{"version":1,'),
      request.body.replace("{", '{"unknown":true,'),
      " " + request.body,
      "x".repeat(PROJECTION_PROTOCOL_LIMITS.requestBytes + 1),
    ]) {
      await expect(verifyProjectionRequest({ ...request, body }, config())).rejects.toThrow();
    }
    const context = await verifyRequest(request);
    const validResponse = await createProjectionResponse(context, observation(), key);
    await expect(
      verifyProjectionResponse(
        { ...validResponse, body: "x".repeat(PROJECTION_PROTOCOL_LIMITS.responseBytes + 1) },
        context,
        config(),
      ),
    ).rejects.toThrow("PROJECTION_BODY_SIZE");
  });

  it("enforces one-second future skew and a five-second receiver-relative lifetime cap", async () => {
    const doubleWindow = await makeRequest(
      "readLatest",
      binding,
      requestId,
      now + 5_000,
      now + 10_000,
    );
    await expect(verifyRequest(doubleWindow)).rejects.toThrow("PROJECTION_EXPIRED");
    const beyondSkew = await makeRequest(
      "readLatest",
      binding,
      requestId,
      now + 1_001,
      now + 4_000,
    );
    await expect(verifyRequest(beyondSkew)).rejects.toThrow("PROJECTION_EXPIRED");
    const request = await makeRequest();
    await expect(
      verifyRequest(
        request,
        config(() => now + 4_001),
      ),
    ).rejects.toThrow("PROJECTION_EXPIRED");
    await expect(
      verifyRequest(
        request,
        config(() => Number.NaN),
      ),
    ).rejects.toThrow("PROJECTION_CLOCK_INVALID");
    await expect(
      verifyRequest(
        request,
        config(() => Number.POSITIVE_INFINITY),
      ),
    ).rejects.toThrow("PROJECTION_CLOCK_INVALID");
  });

  it("rechecks injected clock after request and response WebCrypto verification", async () => {
    const request = await makeRequest();
    const requestTimes = [now, now, now, now + 4_001];
    await expect(
      verifyRequest(
        request,
        config(() => requestTimes.shift() ?? now + 4_001),
      ),
    ).rejects.toThrow("PROJECTION_EXPIRED");
    const context = await verifyRequest(request);
    const response = await createProjectionResponse(context, observation(), key);
    await expect(
      verifyProjectionResponse(
        response,
        context,
        config(() => context.deadlineMs),
      ),
    ).rejects.toThrow("PROJECTION_RESPONSE_STATUS_OR_LATE");
    const responseTimes = [now, now, now + 4_001];
    await expect(
      verifyProjectionResponse(
        response,
        context,
        config(() => responseTimes.shift() ?? now + 4_001),
      ),
    ).rejects.toThrow("PROJECTION_RESPONSE_STATUS_OR_LATE");
  });

  it("detaches and freezes request identity, headers, tuple and key bytes before asynchronous verification", async () => {
    const request = await makeRequest();
    const input: { method: string; path: string; headers: string[][]; body: string } = {
      method: request.method,
      path: request.path,
      headers: request.headers.map((pair) => [...pair]),
      body: request.body,
    };
    const mutableKey = Uint8Array.from(key);
    const mutableTuple = { ...tuple };
    const pending = verifyProjectionRequest(
      input,
      config(() => now, mutableTuple, mutableKey),
    );
    input.method = "GET";
    input.path = "/changed";
    input.body = "{}";
    input.headers[0][1] = "0".repeat(64);
    mutableKey.fill(0);
    mutableTuple.releaseSha = "b".repeat(40);
    const context = await pending;
    expect(context.requestId).toBe(requestId);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.payload)).toBe(true);
    expect(Object.isFrozen(context.tuple)).toBe(true);
    expect(Object.isFrozen(request.headers[0])).toBe(true);
    expect(() => {
      (request.headers[0] as [string, string])[1] = "0".repeat(64);
    }).toThrow();
    expect(() => {
      (context.payload as unknown as { credentialRevision: string }).credentialRevision = "9";
    }).toThrow();
  });
  it("snapshots response, request context, trusted tuple and key bytes before asynchronous verification", async () => {
    const verified = await verifyRequest(await makeRequest());
    const response = await createProjectionResponse(verified, observation(), key);
    const responseInput: { status: number; headers: string[][]; body: string } = {
      status: response.status,
      headers: response.headers.map((pair) => [...pair]),
      body: response.body,
    };
    const context: VerifiedProjectionRequest = {
      ...verified,
      tuple: { ...verified.tuple },
      payload: { ...binding },
    };
    const mutableTuple = { ...tuple };
    const mutableKey = Uint8Array.from(key);
    const pending = verifyProjectionResponse(
      responseInput,
      context,
      config(() => now, mutableTuple, mutableKey),
    );
    responseInput.status = 500;
    responseInput.headers[0][1] = "0".repeat(64);
    responseInput.body = "{}";
    (context as { requestId: string }).requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    (context.payload as { credentialRevision: string }).credentialRevision = "2";
    mutableTuple.epochId = "22222222-2222-4222-8222-222222222222";
    mutableKey.fill(0);
    const parsed = await pending;
    expect((parsed as { observationId: string }).observationId).toBe(observation().observationId);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});
