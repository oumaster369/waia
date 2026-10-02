import { describe, expect, it, vi } from "vitest";
import net from "node:net";
import { parseScheduledPostgresEndpointV1 } from "@/lib/trader/paper/scheduled-owned-postgres-pool-v1";
import { createScheduledPostgresTransportV1 } from "@/lib/trader/paper/scheduled-owned-postgres-transport-v1";

const REFUSED = "SCHEDULED_POSTGRES_DSN_PROFILE_REFUSED";

describe("parseScheduledPostgresEndpointV1", () => {
  it("accepts one remote verify-full endpoint and normalizes its port", () => {
    expect(parseScheduledPostgresEndpointV1("postgresql://user:secret@db.example.test/research?sslmode=verify-full"))
      .toEqual({ host: "db.example.test", port: 5432, tls: true });
  });

  it.each([
    "postgres://user:secret@localhost/research",
    "postgres://user:secret@localhost:5433/research?sslmode=disable",
    "postgres://user:secret@127.0.0.1/research?sslmode=disable",
    "postgres://user:secret@[::1]:5544/research?sslmode=disable",
  ])("accepts loopback synthetic profile %s", (dsn) => {
    expect(parseScheduledPostgresEndpointV1(dsn).tls).toBe(false);
  });

  it("rejects a remote endpoint with omitted SSL mode", () => {
    expect(() => parseScheduledPostgresEndpointV1("postgres://user:secret@db.example.test/research"))
      .toThrow(REFUSED);
  });

  it.each(["disable", "require", "allow", "prefer"]) (
    "rejects remote sslmode=%s rather than weakening verification",
    (sslmode) => {
      expect(() => parseScheduledPostgresEndpointV1(`postgres://user:secret@db.example.test/research?sslmode=${sslmode}`))
        .toThrow(REFUSED);
    },
  );

  it.each([
    "http://user:secret@db.example.test/research?sslmode=verify-full",
    "postgres://user:secret@db.example.test/?sslmode=verify-full",
    "postgres://user:secret@db.example.test/research#fragment",
    "postgres://user:secret@db1.example.test,db2.example.test/research?sslmode=verify-full",
    "postgres://user:secret@db.example.test/research?sslmode=verify-full&sslmode=verify-full",
    "postgres://user:secret@db.example.test/research?sslmode=verify-full&host=127.0.0.1",
    "postgres://user:secret@db.example.test/research?sslmode=verify-full&path=/tmp/socket",
    "postgres://user:secret@db.example.test/research?sslmode=verify-full&port=5432",
    "postgres://user:secret@db.example.test/research?sslmode=verify-full&application_name=probe",
  ])("refuses ambiguous or overridden endpoint profile %s", (dsn) => {
    expect(() => parseScheduledPostgresEndpointV1(dsn)).toThrow(REFUSED);
  });

  it("refuses Node TLS before allocating a socket", async () => {
    const socketSpy = vi.spyOn(net, "Socket");
    try {
      await expect(createScheduledPostgresTransportV1(
        { host: "db.example.test", port: 5432, tls: true }, new AbortController().signal,
      )).rejects.toThrow("SCHEDULED_POSTGRES_NODE_TLS_UNSUPPORTED");
      expect(socketSpy).not.toHaveBeenCalled();
    } finally {
      socketSpy.mockRestore();
    }
  });

  it("rejects an already-aborted signal before allocating a socket", async () => {
    const socketSpy = vi.spyOn(net, "Socket");
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(createScheduledPostgresTransportV1(
        { host: "localhost", port: 5432, tls: false }, controller.signal,
      )).rejects.toThrow();
      expect(socketSpy).not.toHaveBeenCalled();
    } finally {
      socketSpy.mockRestore();
    }
  });

  it("constructs and closes a loopback cleartext factory without dialing", async () => {
    const socketSpy = vi.spyOn(net, "Socket");
    try {
      const transport = await createScheduledPostgresTransportV1(
        { host: "127.0.0.1", port: 5432, tls: false }, new AbortController().signal,
      );
      await transport.close();
      expect(socketSpy).not.toHaveBeenCalled();
    } finally {
      socketSpy.mockRestore();
    }
  });

  it("refuses a sealed factory before allocating a socket", async () => {
    const socketSpy = vi.spyOn(net, "Socket");
    try {
      const transport = await createScheduledPostgresTransportV1(
        { host: "localhost", port: 5432, tls: false }, new AbortController().signal,
      );
      transport.seal();
      await expect(transport.socket()).rejects.toThrow("SCHEDULED_POSTGRES_SCOPE_CLOSED");
      await transport.close();
      expect(socketSpy).not.toHaveBeenCalled();
    } finally {
      socketSpy.mockRestore();
    }
  });
});
