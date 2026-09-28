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
    tags: ["svg", "vector", "drawing", "tracing"],
    art: true,
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
    status: "beta",
    listed: true,
  },
];

export function findApp(slug: string): ToolsApp | undefined {
  return APPS.find((a) => a.slug === slug);
}

export const listedApps = (): readonly ToolsApp[] => APPS.filter((a) => a.listed);
