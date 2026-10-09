# Certs

Not built yet. Status and build order are on the [roadmap](../README.md).

Name: **Certs**. Slug: `certs`. Descriptive title: **X.509 Certificate Inspector**.

The short name fits the developer audience and the site's other tool names. The descriptive
title makes the app's purpose clear; related certificate material can fit as focused extensions.

Purpose: paste a PEM or drop a DER certificate and see readable details beside it, without
sending it to a server for basic inspection.

Initial scope:

- Subject, issuer, serial number and validity dates.
- Subject alternative names, key type and size, signature algorithm and fingerprints.
- Extensions, including constraints, key usages, OCSP locations and CRL distribution points.
- Multiple certificate PEM blocks, with issuer/subject relationships shown as a potential
  chain. A displayed relationship is not itself proof of a verified chain.
- Clear parsing errors and individually labelled checks, rather than one ambiguous
  "valid" badge.

Useful extensions: compare certificates, check a hostname against the certificate's names,
check validity at a chosen time, compare expected fingerprints, and verify signatures
using supplied issuer certificates where supported.

Keep parsing, time checks, hostname matching, signature verification, chain trust and
revocation as separate results. A successful check does not imply all the others passed.
Building a complete trust engine equivalent to a browser, with a maintained root store
and its policies, is beyond the proposed inspector's scope.

## Related inputs and optional CSR inspection

- **Certificate chains:** a certificate and its issuing intermediate certificates, connecting
  it towards a root. Display supplied relationships in the initial inspector; verifying
  signatures and establishing trust are separate checks, and a supplied root is not
  automatically trusted.
- **Certificate signing requests (CSRs):** a public key and requested identity information,
  signed by the applicant and submitted to an issuer before a certificate is issued.
  Optional later inspection could accept PEM or DER requests, show the subject, public key
  and requested extensions such as alternative names, and check the request's signature.
  A verified request signature is not an issuer's endorsement of the requested identity;
  the issuer may change or reject requested fields. See [PKCS #10](https://www.rfc-editor.org/rfc/rfc2986.html).
- **Revocation data:** signed OCSP responses and certificate revocation lists (CRLs), used
  to check revocation within their stated scope and time. Inspection and verification of
  imported data can work locally, as described below.

CSR inspection is an optional extension, not a launch requirement. CSR generation,
private-key management and certificate issuance are outside this inspector's scope.

## Revocation: OCSP and CRLs

An OCSP URL in a certificate identifies a responder; it does not make a complete check
possible from the certificate alone. Constructing the request needs issuer name and key
information. A usable result requires verification of the response signature, authorised
signer, certificate identifier and freshness. OCSP returns good, revoked or unknown;
**good is a revocation status, not proof of overall certificate validity or trust**.
See [RFC 6960](https://www.rfc-editor.org/rfc/rfc6960.html).

There are three possible access paths:

| Path                      | What it enables                                                                                                  | Constraint                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct browser request    | Online checks without a service operated by Tools.                                                               | Requires a responder reachable over HTTPS that permits the browser's cross-origin request; issuer retrieval can face the same restrictions. |
| Optional controlled relay | A server forwards the request; the browser verifies the signed response.                                         | Adds hosting, maintenance and a service dependency; it is an architectural choice, not part of the offline core.                            |
| Imported response         | Generate a ready-to-copy OpenSSL command and let the person import its response for inspection and verification. | Keeps the app static, with a manual external retrieval step and supplied issuer material.                                                   |

There is no general webpage-only bypass for a responder that blocks access. `fetch` with
`no-cors` gives an opaque response that JavaScript cannot read. HTTP requests from an HTTPS
page can also be blocked as mixed content. See
[MDN's CORS explanation and proxy alternative](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors)
and [mixed-content rules](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content).

If a relay is pursued, restrict it to the intended certificate-checking operations, validate
destinations including redirects, prevent access to private networks, and bound request and
response sizes and timeouts. It must not become an arbitrary URL-fetching proxy. Make online
requests an explicit action; offline inspection remains useful when the relay is unavailable.

Frame the feature as revocation checking, rather than OCSP alone. Let's Encrypt ended its
OCSP service on 6 August 2025 and publishes revocation information through CRLs instead
([announcement](https://letsencrypt.org/2025/08/06/ocsp-service-has-reached-end-of-life)).
CRL retrieval encounters the same browser access limits. Importing a CRL is a possible local
extension, with explicit signature, freshness and coverage checks before making a claim.

Suggested progression: offline inspection first, then verification using supplied materials
and imported revocation data; decide separately whether reliable online checks justify a relay.

## Decisions before implementation

- Supported parsing and signature algorithms in the first release.
- Whether imported revocation checks are enough or an optional controlled relay is justified.
- Whether and when to add CSR inspection.
