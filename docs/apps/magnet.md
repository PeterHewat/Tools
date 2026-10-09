# Magnet

Not built yet. Status and build order are on the [roadmap](../README.md).

Purpose: parse, inspect and build magnet links for torrent infohashes, entirely locally.

Initial scope:

- Infohash to a minimal magnet link and magnet link to its constituent fields.
- v1 hashes in hex or Base32, with validation and normalisation.
- v2 and hybrid magnet forms, respecting their different hash encodings.
- Optional display name and editable tracker list, correctly URL-encoded.
- Copyable results and clear malformed-input errors.

The input is a torrent **infohash**, not an arbitrary hash of a downloaded file. A hash can
generate a minimal magnet but cannot recover an original display name or tracker list.
Magnet links can carry both v1 and v2 identifiers for a hybrid torrent. The
[BitTorrent magnet specification](https://www.bittorrent.org/beps/bep_0009.html) defines
these forms. This distinct meaning warrants an app separate from Digests.

Useful extensions: inspect a `.torrent` file, extract its metadata and generate a magnet;
batch parsing/conversion. Infohash calculation must follow the torrent format's exact
hashing rules rather than hash the whole `.torrent` file.

Out of scope: torrent downloading, peer discovery, tracker monitoring and a torrent client.

## Decisions before implementation

- Whether `.torrent` inspection belongs in the first release or follows link conversion.
