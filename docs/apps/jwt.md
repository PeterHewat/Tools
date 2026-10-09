# JWT

Decode, encode and verify JSON Web Tokens with HMAC, RSA, ECDSA and Ed25519.

Decoding, signing and verifying run in the page with Web Crypto. The token and keys stay in the
tab, up to 2 MB.

Editing the encoded token updates the header and payload. Editing the header or payload rebuilds
the token and signs it again when a key that can sign is present. The algorithm is the header's
`alg`; choosing another rewrites the header and signs again. Known header parameters and claims are
explained at the end of their line, with `exp`, `nbf` and `iat` as local dates. Those notes are not
part of the JSON. A token pasted with a `Bearer` prefix, or wrapped over several lines, is made
compact as it is pasted.

HS256, HS384 and HS512 use a shared secret, as UTF-8 text, Base64url, Base64, hex or an oct JWK.
Signing needs at least 32, 48 or 64 bytes. RS, PS, ES and EdDSA verify with the public key and sign
with the private key, each as PEM or JWK. Generate key makes a fresh secret or key pair for the
algorithm.

A valid token is three Base64url parts, with a strict JSON header and payload and an `alg`. A
verified signature means the key matches; it does not mean the claims should be trusted. `alg`
`none` is an unsigned token. An encrypted token (JWE, five parts) shows only its header. `exp`,
`nbf` and `iat` are Unix seconds. Duplicate member names, `crit` and unencoded payloads are refused.

## Later

None yet.
