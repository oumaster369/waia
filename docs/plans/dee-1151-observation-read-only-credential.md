# DEE-1151 — observation-only credential decryption

The unmerged PR714 restricts the observer credential boundary. The generated decision must imply the existing canonical HTX stored read-purpose policy (version, spot market, exact row account identity, warnings and forbidden withdrawal/transfer flags) plus nonempty exclusively-read scopes. A scopes-only or contradictory policy is unverified and must be false. The restricted role sees the boolean, never permission_metadata; all existing RLS and column grants stay in force.

Migration0229 is not applied to production and must remain unapplied there under the user instruction. It can be corrected before merge and tested in isolated local databases. Runtime rollout against a pre0229 production database is not authorized by a green PR: the probe would correctly fail closed.

Acceptance: actual PostgreSQL generated-column matrix with canonical-positive, malformed/missing/contradictory/foreign-account/foreign-venue negatives; actual restricted LOGIN and decrypt boundary; column/tenant rights and no secret leakage; full local targeted checks/build and exact-head CI; independent security review. No trading or wider credential authority. Existing issue remains open for separate defects.
