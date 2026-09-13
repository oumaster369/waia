# DEE-993 Cody reference-conformance amendment v1

Human-approved local implementation: 2026-09-12.
Precedence: this narrow correction supersedes only the erroneous huge-argument
conditional in frozen DEE-518 JINT=0 pseudocode. The historical text is preserved.

## Mathematical correction

Primary reference: https://www.netlib.org/specfun/erf, CALERF JINT=0.
For abs(x) >= 26.543, erf returns the zero-erfc fixup (signed one).
The SQRPI/abs(x) branch belongs to JINT=2, not JINT=0.
Keep all coefficients, other branches, thresholds and Phi(z)=(1+erf(z/sqrt(2)))/2.
No new clipping, floors, smoothing, normalization or observation filtering.

## Identities and invalidation

Keep cdf-erf-cody715/v1 as diagnostic-only historical implementation.
Active kernel: cdf-erf-cody715/v2.
Affected baseline identities: gaussian-pop-std/v2 and ewma-lambda094/v3.
The other three mandatory baseline identities remain unchanged.
Trial-id/v2 serialization remains unchanged: the affected baseline IDs bind new
trial digests (and therefore new addressed resampling identities).
Harness: research-harness-admission/v5; harness receipt: scientific-admission-receipt/v5.
Predictive Terminal: predictive-terminal-receipt/v3. Outer scientific receipt:
scientific-admission-receipt/v4. Kernel version and this document's SHA-256 are
bound to harness digest and Terminal body, checked before either terminal verdict.
Terminal checkpoint stage: wf-predictive-terminal-v3. Original source package,
forecast-batch and score-independent partition identities remain unchanged.
A later local migration replaces only the protocol predicates from 0206,
retaining its organization, request, proposal and Human-approval predicates.
Historical receipts/checkpoints are never rewritten or relabeled.

## Preserved scientific criteria and scope

Brier reward, all five baselines, B=10000, addressed stationary-bootstrap law,
positive-mean requirement and Holm alpha=0.05 remain unchanged.
No original corpus evaluation was used to choose this correction.
Empirical challenger forecast generation does not depend on this CDF; the
correction alone does not require regenerating those bytes. DEE-991 original
provenance and completeness checks are still required for reuse.
Local synthetic validation only. No deployment, production migration, checkpoint
mutation, original-data scoring, bootstrap or scientific qualification is authorized.

## Acceptance

Reference known answers, tails and branch boundaries; NaN/infinities; monotonicity;
unchanged ordinary-domain outputs versus v1; Gaussian/EWMA bucket mass validity;
digest/version separation; missing/old/mixed protocol rejection, including resealed
objects and non-qualified receipts; local PostgreSQL protocol predicate validation;
independent bounded review. This amendment grants no historical/live admission.
