# Account observation projection image

This image packages the fixed Node projection service only. The final stage contains the bundled entry point, its dependency manifest, Node 22, and Alpine's `flock` package; collector, credential, HTX transport, and trading modules are rejected by the bundle allowlist and are not copied into the final image. The Node process listens only on the approved Unix socket created by the host entry point.

Build locally from the repository root:

```sh
docker build --build-arg WAIA_IMAGE_RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  -f services/account-observation-projection/Dockerfile \
  -t waia-projection-native:local .
```

The Dockerfile-specific ignore file keeps unrelated repository files out of the build context. The builder installs the exact locked dependency graph with `pnpm-lock.yaml`, resolves its esbuild version from the locked `tsx` dependency, bundles under the `react-server` condition, and emits `/app/dependency-manifest.json` alongside the bundle. It fails closed if any repository source outside the reviewed projection allowlist enters the module closure.

The launcher requires Linux, UID 10001, runtime directory `/run/waia-observation-projection` owned by UID 10001 with mode `2750`, and a regular, single-link `lifetime.lock` owned by UID 10001 with mode `0600`. It opens the stable lock inode as FD 9, acquires a nonblocking exclusive `flock`, verifies the path still names the held inode, clears inherited environment values, then `exec`s Node by its fixed absolute path. A contending process exits unavailable with status 75. FD 9 remains open across `exec`; the kernel releases the lock only when the service process exits. No startup or shutdown path unlinks the lock file.

The build requires a 40-character lowercase release SHA. It is written to root-owned, mode-0644 `/app/release-sha`; the Node entry point compares it with the pinned config tuple before opening the pool. The runtime owner must provide the shared runtime directory as a stable volume with the stated owner and mode. The tunnel connector needs read/execute access to that directory and group access to the socket, but does not need directory write access. The root-owned entry point verifies the inherited Linux lock descriptor and reads the fixed configuration and secret files from `/run/secrets/waia-projection/`. Required names are `config.json`, `reader-url`, and `hmac-key`; mount `reader-url` and `hmac-key` owned by UID 10001 with mode 0400 so the unprivileged process can read them without widening permissions. Isolated tests may additionally mount `test-ca.crt`. Production CA trust is bundled with the Node database TLS helper.

This image package does not provision a service, tunnel, DNS record, secret, database role, or host resource. Do not run it against live dependencies as part of local packaging work.
