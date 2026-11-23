# Agents City hybrid establishment crypto

Narrow Rust/WASM boundary for the experimental `ML-KEM-768 + X25519`
initial-session wrapper. It validates FIPS 203 keys, combines both independent
secrets with HKDF-SHA-256, binds the canonical Road transcript as AES-256-GCM
associated data, and never implements a fallback to a classical-only suite.

This package is not a claim that the complete Agents City integration has been
independently audited. The v4 production gate remains closed until that review
and the linked sandbox evidence exist.
