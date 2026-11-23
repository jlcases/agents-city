# Third-party cryptography

`@agents-city/connect-client` uses `@kinsh/vodozemac-wasm` 0.4.2 for its
Olm Double Ratchet implementation. The binding and the underlying
`matrix-org/vodozemac` library are licensed under Apache License 2.0.

- Binding source: https://github.com/Meneleus/vodozemac-bindings
- Cryptographic implementation: https://github.com/matrix-org/vodozemac
- Independent vodozemac audit: https://leastauthority.com/blog/audit-of-vodozemac-library-for-matrix-org/
- Licence text: `licenses/vodozemac-Apache-2.0.txt`

No `libsignal` source or binary is linked, copied, vendored, or distributed.
Signal's published protocol documents are used only as a security-properties
reference. Agents City retains its Apache-2.0 licensing boundary.

Persistent Node clients use `@napi-rs/keyring` 1.3.0 to keep the ratchet-state
master key in macOS Keychain, Windows Credential Manager, or Linux Secret
Service. The package is distributed under the MIT License.

- Source: https://github.com/Brooooooklyn/keyring-node
- Licence text: `licenses/keyring-MIT.txt`
