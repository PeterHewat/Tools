# Password

Not built yet. Status and build order are on the [roadmap](../README.md).

Purpose: generate strong passwords and passphrases locally, with their strength shown plainly.

Initial scope:

- Random passwords with a chosen length and character sets (lower, upper, digits, symbols),
  an option to leave out look-alike characters, and at least one character from each chosen set.
- Passphrases from a built-in word list, with a chosen word count, separator and optional
  capitals or digit.
- Entropy in bits for every result, worked out from the settings rather than guessed from the
  text.
- Several results at once to pick from, each copyable, and a regenerate button.

All randomness comes from `crypto.getRandomValues`, with rejection sampling so every character
and word is equally likely. Nothing generated is stored: settings are kept, results are not.

Out of scope: a password manager, saving or syncing passwords, and checking passwords against
breach lists.

## Decisions before implementation

- Which word list ships for passphrases (EFF large list or similar) and its effect on the
  bundle budget.
- Whether a strength check for a typed password belongs in the first release.
