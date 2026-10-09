# Codec

Convert UTF-8 text, Base64, Base64url, URL components and hex, with every byte visible.

Every field holds the same bytes. Editing one rewrites the others; the field being edited is left
as written. While the text cannot be read yet, the error shows beside its name and the other fields
keep their last value.

UTF-8 is kept byte for byte, including Windows line breaks. Invisible characters are drawn. Bytes
that are not valid UTF-8 leave the text field empty. URL component is percent-encoding; a `+` is a
plus, not a space. Base64 accepts white space and optional padding; Base64url uses the unpadded
URL-safe alphabet. Hex accepts white space between complete byte pairs.

Digests, beside the text, opens the Digests app on the same bytes.

## Later

None yet.
