# Digests

Hash text and files with every SHA at once, check an expected digest, and compute HMAC.

Text is hashed as its exact UTF-8 bytes. Invisible characters are drawn, and the byte count is
shown. A file is hashed in the browser, up to 64 MiB, and has to be chosen again after a reload.
Codec opens the same text, or a file up to 1 MiB as Base64.

SHA-256, SHA-384, SHA-512 and SHA-1 are computed together, in hex or Base64. SHA-1 is legacy: do not
rely on it for security. Pasting an expected digest names the algorithm it matches. With HMAC on,
each result is the HMAC of the input keyed by a non-empty key in UTF-8, hex, Base64 or Base64url.

A digest is not encryption. Web Crypto needs HTTPS or localhost.

## Later

None yet.
