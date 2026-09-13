# Isolated native bootstrap experiment

DEE-998 preserves `validation-bootstrap/v2` mathematical behavior. This directory
is **not imported by the application, selected by the runner, or copied into the
execution image**. Its stdout is not an admission receipt. No partial p-value is
returned. Full integration, authenticated reuse and complete-range aggregation
remain separate work.

Linux/OpenSSL 3 build and mandatory installed-binary parity:

```sh
g++ -O3 -std=c++17 -fno-fast-math -ffp-contract=off \
  scripts/trader/native/validation-bootstrap-range.cpp \
  -l:libcrypto.so.3 -o /tmp/waia-native-bootstrap-range
node --import tsx scripts/trader/test-native-bootstrap-range.ts /tmp/waia-native-bootstrap-range
```

On macOS, supply the installed OpenSSL 3 include/library paths to the compiler.
No fast math, contraction, altered rounding mode or implicit precision change is
admissible. OpenSSL's low-level Transform API is deprecated; the experiment uses
the public OpenSSL 3 context layout only. A source-compatible build is not a
substitute for exact parity on the target executable and host.

The driver checks ordered binary64 resample-statistic digests and exact observed
statistics against JavaScript, including independent small-case RNG/transitions,
two complete B=10000 small cases and two ordinals at N=525547. It also exercises
the **same** Sampler on a fixed million-address vector with 80 rejection events,
and rejects malformed frames and non-finite arithmetic at multiple stages.

Optional bounded synthetic concurrency measurement after parity passes:

```sh
node --import tsx scripts/trader/benchmark-native-bootstrap-range.ts /tmp/waia-native-bootstrap-range
```

This uses no market data, checkpoints or network. It compares the same four
eight-ordinal ranges serially and in four processes, twice. Range outputs must
match byte-for-byte. Throughput is not a forecast-generation estimate or evidence
of statistical qualification. The trial identity is explicitly synthetic.

Protocol: stdin `WAIAVB01` (8 bytes), n/start/endExclusive u32LE, original 32-byte
trial digest, then n binary64LE differentials. Exact length, finite intermediate
arithmetic, 1<=n<=1000000 and 0<=start<end<=10000 are enforced. An unbounded stream
must be supervised externally with a timeout. Fixed `--self-test-rng` is the only
other mode; it does not accept caller seeds or overrides.

Before any eventual production use, pin source/compiler/library/executable/input
identities and review complete-range validation, durable authenticated storage,
cancellation/retry behavior and scientific provenance. Never adopt an arbitrary
binary path or caller-supplied range result in an authority-bearing API.
