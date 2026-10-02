/**
 * The app catalog: the single source of truth for what lives in this repo.
 *
 * Adding an app means adding one entry here and one folder under `apps/`.
 * The site index, each app's document head and manifest, and the build all read from this —
 * nothing about the list is maintained by hand in two places.
 */

export type AppStatus = "stable" | "beta" | "experiment";

export interface ToolsApp {
  /** URL segment and workspace folder name under `apps/`. */
  readonly slug: string;
  /** Display name. */
  readonly name: string;
  /**
   * What the app is in full, beside its name in the header ("JWT  JSON Web Token Debugger") when
   * the name alone is an abbreviation. Cut short, then hidden, as the header narrows.
   */
  readonly title?: string;
  /** One line, shown on the index card and used as the meta description. */
  readonly blurb: string;
  /** Longer description for the app's own page head. Falls back to `blurb`. */
  readonly description?: string;
  /** Inline SVG path data for the index card icon, drawn on a 24x24 grid. */
  readonly icon: string;
  readonly tags: readonly string[];
  /**
   * The app ships `public/art.svg`, a 320 x 320 picture shown across the top of its index card.
   * Its background should be translucent or absent, so it sits on the card in either theme.
   */
  readonly art?: boolean;
  /**
   * Widest screen (px) at which the header's start reduces from "‹ Tools  Name" to "‹": the
   * width the header needs with the words, so it collapses as soon as they stop fitting.
   * 720 when not given; false keeps the name and title at every width.
   */
  readonly compactHeader?: number | false;
  /**
   * Widest screen (px) at which "‹ Tools" alone reduces to "‹", the app's name staying beside
   * it: a step before `compactHeader`, for an app whose name in full needs the room.
   */
  readonly compactHome?: number;
  /** Production JavaScript gzip budgets in KiB; entry includes static module preloads. */
  readonly jsBudget?: { readonly entryGzip: number; readonly totalGzip: number };
  readonly status: AppStatus;
  /** Hidden from the index while false. Still built. */
  readonly listed: boolean;
}

export const APPS: readonly ToolsApp[] = [
  {
    slug: "svg",
    name: "SVG",
    blurb:
      "Trace images with a Bézier pen and shapes; combine, align, group and fill with gradients. A searchable library of drawings, exported as clean SVG or PNG.",
    description:
      "A single-page SVG tracing editor. Place reference images, draw over them with a Bézier pen and standard shapes, then export pure SVG with no raster embedded.",
    icon: "M6 18.5c3-10 6-13 8-13s2 3 0 6-5 4-7 4 8 1 11-4",
    tags: ["svg", "vector", "drawing", "tracing", "design"],
    art: true,
    compactHeader: 665,
    jsBudget: { entryGzip: 80, totalGzip: 210 },
    status: "stable",
    listed: true,
  },
  {
    slug: "json",
    name: "JSON",
    blurb:
      "Format, minify, fold and validate JSON, and fix almost-JSON. Convert it to YAML, CSV, TypeScript types or a JSON Schema.",
    icon: "M8 4C6 4 5.5 5 5.5 7v2.5C5.5 11 4.5 12 3.5 12c1 0 2 1 2 2.5V17c0 2 .5 3 2.5 3M16 4c2 0 2.5 1 2.5 3v2.5c0 1.5 1 2.5 2 2.5-1 0-2 1-2 2.5V17c0 2-.5 3-2.5 3",
    tags: ["json", "format", "validate", "fold", "convert", "developer"],
    art: true,
    compactHeader: 730,
    jsBudget: { entryGzip: 150, totalGzip: 150 },
    status: "stable",
    listed: true,
  },
  {
    slug: "jwt",
    name: "JWT",
    title: "JSON Web Token Debugger",
    blurb: "Decode, encode and verify JSON Web Tokens with HMAC, RSA, ECDSA and Ed25519.",
    icon: "M4 7h16v10H4zM8 7v10m8-10v10M6 4h12M6 20h12",
    tags: ["jwt", "token", "decode", "encode", "verify", "developer"],
    art: true,
    compactHeader: false,
    compactHome: 389,
    jsBudget: { entryGzip: 140, totalGzip: 140 },
    status: "stable",
    listed: true,
  },
  {
    slug: "codes",
    name: "Codes",
    blurb:
      "QR codes for links, Wi-Fi, contacts, events and more, with your colours, shapes, logo and frame; plus Code 128, EAN-13 and UPC-A barcodes.",
    icon: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v9H3m9 3v6m3-9h6",
    tags: ["qr", "barcode", "wifi", "vcard", "logo", "svg", "png", "print"],
    art: true,
    compactHeader: 268,
    jsBudget: { entryGzip: 18, totalGzip: 18 },
    status: "stable",
    listed: true,
  },
  {
    slug: "codec",
    name: "Codec",
    title: "UTF-8, Base64, URL and Hex Converter",
    blurb:
      "Convert UTF-8 text, Base64, Base64url, URL components and hex, with every byte visible.",
    icon: "M3 8h16l-4-4m4 4-4 4M21 16H5l4-4m-4 4 4 4",
    tags: ["base64", "hex", "url", "utf-8", "encoding", "developer"],
    art: true,
    compactHeader: false,
    compactHome: 467,
    jsBudget: { entryGzip: 135, totalGzip: 135 },
    status: "stable",
    listed: true,
  },
  {
    slug: "digests",
    name: "Digests",
    blurb: "Hash text and files with SHA-256, SHA-384 or SHA-512, and compute HMAC locally.",
    icon: "M9 3 7 21M17 3l-2 18M3 9h18M3 15h18",
    tags: ["hash", "sha", "digest", "hmac", "files", "developer"],
    art: true,
    compactHeader: 276,
    jsBudget: { entryGzip: 7, totalGzip: 7 },
    status: "stable",
    listed: true,
  },
];

export function findApp(slug: string): ToolsApp | undefined {
  return APPS.find((a) => a.slug === slug);
}

export const listedApps = (): readonly ToolsApp[] => APPS.filter((a) => a.listed);
