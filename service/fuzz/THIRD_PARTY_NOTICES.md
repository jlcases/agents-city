# Fuzzing-only third-party notices

These tools are development dependencies. They are not linked into the Agents
City relay, client, website, or generated hybrid WASM artifact.

- `@jazzer.js/core 4.0.0` and its `@jazzer.js/*` packages — Apache-2.0 —
  https://github.com/CodeIntelligenceTesting/jazzer.js
- `cargo-fuzz 0.13.2` — Apache-2.0 OR MIT —
  https://github.com/rust-fuzz/cargo-fuzz
- `libfuzzer-sys 0.4.13` — MIT OR Apache-2.0, with LLVM components under
  NCSA — https://github.com/rust-fuzz/libfuzzer

The complete resolved dependency trees and integrity hashes are pinned by
`package-lock.json` and `packages/hybrid-crypto/fuzz/Cargo.lock`.
