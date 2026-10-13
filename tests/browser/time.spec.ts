import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Every expectation below is in Paris time and British English, whatever the machine running it.
test.use({ timezoneId: "Europe/Paris", locale: "en-GB" });

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
/** Ana in Paris prefers 18:00–21:00; Ben in New York prefers 12:00–15:00: 18:00–21:00 in Paris. */
const PEOPLE = [
  {
    id: "a",
    name: "Ana",
    zone: "Europe/Paris",
    windows: [
      { days: EVERY_DAY, start: 480, end: 1320, level: "acceptable" },
      { days: EVERY_DAY, start: 1080, end: 1260, level: "preferred" },
    ],
    exceptions: [],
  },
  {
    id: "b",
    name: "Ben",
    zone: "America/New_York",
    windows: [
      { days: EVERY_DAY, start: 480, end: 1200, level: "acceptable" },
      { days: EVERY_DAY, start: 720, end: 900, level: "preferred" },
    ],
    exceptions: [],
  },
];

/**
 * Time on a plan and a draft, at a fixed moment: by default 22:00 in Paris on Sunday 11 October
 * 2026, the evening before the day the tests search, since times already past are never suggested.
 */
async function open(
  page: Page,
  people: unknown[],
  draft: Record<string, unknown> = {},
  now = "2026-10-11T20:00:00Z"
) {
  await page.clock.setFixedTime(new Date(now));
  // Written from another page of the site: Time keeps its own draft as it is left.
  await page.goto("/Tools/");
  await page.evaluate(
    ([people, draft]) => {
      localStorage.setItem("tools.time.plan", JSON.stringify({ version: 1, duration: 60, people }));
      sessionStorage.setItem("tools.time.draft", JSON.stringify({ version: 1, value: draft }));
    },
    [people, draft] as const
  );
  await page.goto("/Tools/time/");
}

const row = (page: Page, label: string) =>
  page
    .locator(".time-result")
    .filter({ has: page.locator(".time-result-label", { hasText: label }) });

test("Time converts both ways, asks which of a doubled time and explains a skipped one", async ({
  page,
}) => {
  await page.goto("/Tools/time/");
  // A new tab opens on Find a time, the first view.
  await expect(page.locator("#view-meet")).toBeVisible();
  await page.locator('[data-view="convert"]').click();
  const input = page.locator("#input");
  await input.fill("1760264100");
  await expect(page.locator("#input-note")).toHaveText("Unix seconds, by its size.");
  await expect(row(page, "UTC").locator("code")).toHaveText("2025-10-12T10:15:00Z");
  await expect(row(page, "This device").locator("code")).toHaveText("2025-10-12T12:15:00+02:00");
  await expect(row(page, "Unix milliseconds").locator("code")).toHaveText("1760264100000");
  await expect(row(page, "HTTP date").locator("code")).toHaveText("Sun, 12 Oct 2025 10:15:00 GMT");
  // A unit writes the timestamp in it, the same instant; what is typed after is read in it.
  await page.locator('[data-unit="ms"]').click();
  await expect(input).toHaveValue("1760264100000");
  await expect(page.locator("#input-note")).toHaveText("Unix milliseconds.");
  await expect(row(page, "UTC").locator("code")).toHaveText("2025-10-12T10:15:00Z");
  await page.locator('[data-unit="s"]').click();
  await expect(input).toHaveValue("1760264100");
  await input.fill("1760264100123");
  await expect(row(page, "UTC").locator("code")).not.toContainText("2025-");
  await page.locator('[data-unit="auto"]').click();
  await expect(row(page, "UTC").locator("code")).toHaveText("2025-10-12T10:15:00.123Z");

  // Paris turns its clocks back on 25 October 2026: 02:30 happens twice.
  await input.fill("2026-10-25T02:30");
  await expect(page.locator("#choice-text")).toContainText("happens twice");
  await expect(page.locator("#input-note")).toContainText("Choose which of the two times.");
  await page.getByRole("button", { name: "Second, UTC+01:00" }).click();
  await expect(row(page, "UTC").locator("code")).toHaveText("2026-10-25T01:30:00Z");
  await expect(page.getByRole("button", { name: "Second, UTC+01:00" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // And forward on 29 March: 02:30 never happens, and is read as the time after the change.
  await input.fill("2026-03-29T02:30");
  await expect(page.locator("#choice")).toBeHidden();
  await expect(page.locator("#input-note")).toContainText("does not exist");
  await expect(row(page, "This device").locator("code")).toHaveText("2026-03-29T03:30:00+02:00");

  // A date alone is midnight in the zone it is read in, which can be changed.
  await input.fill("2026-10-12");
  await page.locator("#input-zone").fill("tokyo");
  await page.locator("#input-zone").press("Tab");
  await expect(page.locator("#input-zone")).toHaveValue("Asia/Tokyo");
  await expect(page.locator("#input-note")).toHaveText("00:00 in Asia/Tokyo assumed.");
  await expect(row(page, "UTC").locator("code")).toHaveText("2026-10-11T15:00:00Z");
  await expect(row(page, "Read in").locator("code")).toHaveText("2026-10-12T00:00:00+09:00");

  // A zone pinned stays for every result after.
  await page.locator("#pin-zone").fill("adelaide");
  await page.locator("#pin-zone").press("Enter");
  await expect(row(page, "Australia/Adelaide").locator("code")).toHaveText(
    "2026-10-12T01:30:00+10:30"
  );
  await page.reload();
  await expect(row(page, "Australia/Adelaide")).toBeVisible();

  // Several lines are a table; labels and JSON members are read, and a bad line says why.
  await input.fill('exp: 1760264100\n"iat": 1760260500,\nsoon');
  await expect(page.locator("#results-card")).toBeHidden();
  await expect(page.locator("#batch tbody tr")).toHaveCount(3);
  await expect(page.locator("#batch thead")).toContainText("Label");
  await expect(page.locator("#batch tbody tr").nth(1)).toContainText("2025-10-12T09:15:00Z");
  await expect(page.locator("#batch tbody tr").nth(2)).toHaveAttribute("data-error", "true");
  await expect(page.locator("#batch-note")).toHaveText("1 could not be read.");
});

test("Time finds a call time, explains compromises, relaxes on request and shares a snapshot", async ({
  page,
  context,
}) => {
  const day = {
    view: "meet",
    rangeFrom: "2026-10-12",
    rangeTo: "2026-10-12",
    meetZone: "Europe/Paris",
  };
  await open(page, PEOPLE, day);
  const first = page.locator(".time-suggestion").first();
  // The short date is the browser's: "Mon 12 Oct" in some, "Mon, 12 Oct" in WebKit on Linux.
  await expect(first).toContainText(/Mon,? 12 Oct, 18:00–19:00/);
  await expect(first).toContainText("or start any time until 20:00");
  await expect(first).toContainText("Everyone: preferred hours.");
  await expect(first).toHaveAttribute("data-tier", "preferred");
  // The call is on the best suggestion before anyone chooses.
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#picked-summary")).toHaveText(
    /^Call, 1 h\nAna \(Europe\/Paris\): Mon,? 12 Oct, 18:00–19:00\nBen \(America\/New_York\): Mon,? 12 Oct, 12:00–13:00$/
  );
  await expect(page.locator(".tl-row")).toHaveCount(3);
  await expect(page.locator(".tl-call")).toHaveCount(3);
  // Placing the call by its time says how it sits with everyone.
  await page.locator("#picked-time").fill("22:00");
  await page.locator("#picked-time").dispatchEvent("change");
  await expect(page.locator("#picked-text")).toContainText("Does not fit: Ana is unavailable");

  // Cy in Tokyo accepts 07:00–09:00, 00:00–02:00 in Paris, when Ana is unavailable.
  const cy = {
    id: "c",
    name: "Cy",
    zone: "Asia/Tokyo",
    windows: [{ days: EVERY_DAY, start: 420, end: 540, level: "acceptable" }],
    exceptions: [],
  };
  await open(page, [...PEOPLE, cy], day);
  await expect(page.locator("#suggestions-note")).toHaveText("None fits.");
  await expect(page.locator("#diagnosis")).toContainText("Without Cy");
  await expect(page.locator("#diagnosis")).toContainText("Without Ana");
  await page.getByRole("button", { name: "Allow Ana's unavailable time" }).click();
  await expect(page.locator(".time-suggestion").first()).toHaveAttribute("data-tier", "relaxed");
  await expect(page.locator(".time-suggestion").first()).toContainText(
    "Ana: 1 h in unavailable time"
  );
  await expect(page.locator('[data-person="a"] .time-badge')).toHaveText("Relaxed");

  // Share link: the snapshot opens elsewhere and asks before it replaces anything.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => void ((window as { copied?: string }).copied = text),
      },
    });
  });
  await page.locator("#share").click();
  await expect(page.locator("#people-note")).toContainText("Link copied");
  const link = await page.evaluate(() => (window as { copied?: string }).copied!);
  expect(link).toMatch(/\/time\/#plan=[zj][A-Za-z0-9_-]+$/);
  const other = await context.newPage();
  await other.goto("/Tools/time/");
  await other.evaluate(() => localStorage.removeItem("tools.time.plan"));
  await other.goto(link);
  await expect(other.locator("#view-meet")).toBeVisible();
  await expect(other.locator("#snapshot-text")).toContainText("3 people (Ana, Ben, Cy)");
  await expect(other.locator("#snapshot-text")).toContainText("not live answers");
  expect(other.url()).not.toContain("#plan=");
  await other.locator("#snapshot-replace").click();
  await expect(other.locator(".time-person")).toHaveCount(3);
  await expect(other.locator(".time-person summary").first()).toContainText("Relaxed");
  // The bin beside a person's chevron removes them, without folding or opening the card.
  await other.getByRole("button", { name: "Remove Cy" }).click();
  await expect(other.locator(".time-person")).toHaveCount(2);
  await expect(other.locator(".time-person").first()).toHaveAttribute("open", "");
});

test("Time measures ages and spans on the calendar and in elapsed units", async ({ page }) => {
  await page.goto("/Tools/time/");
  await page.locator('[data-view="duration"]').click();
  // To starts on now; between two dates, it is switched off.
  await expect(page.locator("#end-now")).toHaveAttribute("aria-checked", "true");
  await page.locator("#end-now").click();
  await page.locator("#start-date").fill("2000-02-29");
  await page.locator("#end-date").fill("2001-02-28");
  await expect(page.locator("#span")).toHaveText("1 year");
  await expect(page.locator(".time-total").filter({ hasText: "Days" }).locator("code")).toHaveText(
    "365"
  );
  await expect(page.locator("#dur-assume")).toContainText("From: 00:00 assumed.");
  // A day across the clock change is a calendar day, but 23 hours elapsed.
  await page.locator("#start-date").fill("2026-03-28");
  await page.locator("#start-time").fill("12:00");
  await page.locator("#end-date").fill("2026-03-29");
  await page.locator("#end-time").fill("12:00");
  await expect(page.locator("#span")).toHaveText("1 day");
  await expect(page.locator(".time-total").filter({ hasText: "Hours" }).locator("code")).toHaveText(
    "23"
  );
  await expect(page.locator(".time-total").filter({ hasText: "Days" }).locator("code")).toHaveText(
    "0"
  );
  await page.locator('[data-rounding="nearest"]').click();
  await expect(page.locator(".time-total").filter({ hasText: "Days" }).locator("code")).toHaveText(
    "1"
  );

  // An age: a birth date to now, and when it next comes round.
  await page.locator("#end-now").click();
  // A date is typed year first, however short, and written out in full.
  await page.locator("#start-date").fill("1990-5-20");
  await page.locator("#start-date").blur();
  await expect(page.locator("#start-date")).toHaveValue("1990-05-20");
  await page.locator("#start-time").fill("");
  await expect(page.locator("#span")).toHaveText(/^\d+ years, /);
  await expect(page.locator("#span")).not.toContainText("hour");
  await expect(page.locator("#span-extra")).toContainText(
    /^\d+ years on \d+ May \d{4}, in \d+ days/
  );
  await expect(page.locator("#end-date")).toBeDisabled();
  await expect(page.locator(".time-total").filter({ hasText: "Weeks" })).toHaveCount(0);
  // A time that cannot be read says so, rather than counting from midnight.
  await page.locator("#start-time").fill("25:00");
  await page.locator("#start-time").blur();
  await expect(page.locator("#start-time")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#dur-assume")).toContainText("type the time as HH:MM");
  await expect(page.locator("#span")).toHaveText("—");
  // Only one end is now: switching From to now switches To back to its date.
  await page.locator("#start-now").click();
  await expect(page.locator("#start-now")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#end-now")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#end-date")).toBeEnabled();
});

test("a reload shows the view and the folds the tab had, from the first paint", async ({
  page,
}) => {
  await open(page, PEOPLE, { view: "meet", rangeFrom: "2026-10-12", rangeTo: "2026-10-12" });
  // Suggestions start folded to their heading and count; the call is already on the best one.
  const toggle = page.locator("#suggestions-toggle");
  await expect(page.locator("#suggestions")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#suggestions-note")).toContainText("preferred by everyone");
  await expect(page.locator("#suggestions-row .time-chevron svg path")).toHaveCount(1);
  await expect(page.locator("#picked-time")).toHaveValue("18:00");
  // They open from their heading, or anywhere on its row.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#suggestions")).toBeVisible();
  await page.locator('[data-view="convert"]').click();

  // With the app's script blocked, what shows is what the page paints before it runs.
  await page.route(/\/time\/assets\/.*\.js$/, (route) => route.abort());
  await page.reload();
  await expect(page.locator("#view-convert")).toBeVisible();
  await expect(page.locator("#view-meet")).toBeHidden();
  await expect(page.locator('[data-view="convert"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-view="meet"]')).toHaveAttribute("aria-pressed", "false");
  await page.unroute(/\/time\/assets\/.*\.js$/);

  await page.reload();
  await page.locator('[data-view="meet"]').click();
  await expect(page.locator("#suggestions")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.locator("#suggestions-row").click({ position: { x: 300, y: 10 } });
  await expect(page.locator("#suggestions")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("times already past are never suggested", async ({ page }) => {
  const day = {
    view: "meet",
    rangeFrom: "2026-10-12",
    rangeTo: "2026-10-12",
    meetZone: "Europe/Paris",
  };
  // 18:20 in Paris: the overlap from 18:00 has begun, so the soonest start is 18:30.
  await open(page, PEOPLE, day, "2026-10-12T16:20:00Z");
  const first = page.locator(".time-suggestion").first();
  await expect(first).toContainText(/Mon,? 12 Oct, 18:30–19:30/);
  await expect(first).toContainText("or start any time until 20:00");
  await expect(page.locator("#picked-time")).toHaveValue("18:30");
  // A call placed in the past by hand says so.
  await page.locator("#picked-time").fill("10:00");
  await page.locator("#picked-time").dispatchEvent("change");
  await expect(page.locator("#picked-text")).toContainText("That time has passed.");
  // Dates wholly past leave nothing to search.
  await open(page, PEOPLE, day, "2026-10-13T06:00:00Z");
  await expect(page.locator("#search-note")).toHaveText(
    "No time is left in these dates: search from today on."
  );
  await expect(page.locator(".time-suggestion")).toHaveCount(0);
});

test("dragging the call along the timeline moves it as the pointer moves", async ({ page }) => {
  await open(page, PEOPLE, {
    view: "meet",
    rangeFrom: "2026-10-12",
    rangeTo: "2026-10-12",
    meetZone: "Europe/Paris",
  });
  const picked = page.locator("#picked-time");
  await expect(picked).toHaveValue("18:00");
  const bar = (await page.locator(".tl-all .tl-bar").boundingBox())!;
  const hour = bar.width / 24;
  const y = bar.y + bar.height / 2;
  // Grabbed in its middle, the call keeps that hold as it moves, an hour at a time here.
  await page.mouse.move(bar.x + 18.5 * hour, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + 19.5 * hour, y, { steps: 4 });
  await expect(picked).toHaveValue("19:00");
  await page.mouse.move(bar.x + 20.5 * hour, y, { steps: 4 });
  await expect(picked).toHaveValue("20:00");
  await page.mouse.move(bar.x + 21.5 * hour, y, { steps: 4 });
  await expect(picked).toHaveValue("21:00");
  await page.mouse.up();
  await expect(page.locator("#picked-text")).toContainText("Ana: 1 h outside preferred hours");
  // A press away from the call places it there.
  await page.mouse.click(bar.x + 9.2 * hour, y);
  await expect(picked).toHaveValue("09:00");
});

test.describe("in American English", () => {
  test.use({ locale: "en-US" });
  test("times are on the 24-hour clock, shown and typed", async ({ page }) => {
    await open(page, PEOPLE, {
      view: "meet",
      rangeFrom: "2026-10-12",
      rangeTo: "2026-10-12",
      meetZone: "Europe/Paris",
    });
    const first = page.locator(".time-suggestion").first();
    await expect(first).toContainText("18:00–19:00");
    await expect(first).toContainText("Ana 18:00 · Ben 12:00");
    await expect(page.locator("#view-meet")).not.toContainText(/\d (AM|PM)\b/);
    // A window's hours are typed fields, read however they are typed and written as HH:MM.
    const from = page.locator('[data-person="a"] [data-field="start"]').first();
    await expect(from).toHaveValue("08:00");
    await from.fill("930");
    await from.blur();
    await expect(from).toHaveValue("09:30");

    await page.locator('[data-view="convert"]').click();
    await page.locator("#input").fill("1760264100");
    await expect(row(page, "This device")).toContainText("12:15:00");
    await expect(page.locator("#view-convert")).not.toContainText(/\d (AM|PM)\b/);
    // Now writes the unit chosen: milliseconds once Milliseconds is pressed.
    await page.locator('[data-unit="ms"]').click();
    await expect(page.locator("#input")).toHaveValue("1760264100000");
    await page.locator("#now").click();
    await expect(page.locator("#input")).toHaveValue(/^\d{13}$/);
    // The time field writes the input as it is typed.
    await page.locator("#pick-date").fill("2026-12-25");
    await page.locator("#pick-time").fill("9:05");
    await expect(page.locator("#input")).toHaveValue("2026-12-25T09:05:00");
  });
});

test("JWT opens Time on the token's time claims", async ({ page }) => {
  await page.goto("/Tools/jwt/");
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token =
    part({ alg: "HS256", typ: "JWT" }) +
    "." +
    part({ sub: "x", iat: 1760260500, exp: 1760264100 }) +
    ".c2ln";
  await page.getByRole("textbox", { name: "JSON Web Token", exact: true }).fill(token);
  await page.locator("#to-time").click();
  await expect(page).toHaveURL(/\/time\/$/);
  await expect(page.locator("#batch tbody tr")).toHaveCount(2);
  await expect(page.locator("#batch tbody tr").first()).toContainText("exp");
  await expect(page.locator("#batch tbody tr").first()).toContainText("2025-10-12T10:15:00Z");
});

test("Time's views have no automated WCAG A/AA violations in either theme", async ({ page }) => {
  await open(page, PEOPLE, { rangeFrom: "2026-10-12", rangeTo: "2026-10-13" });
  for (const view of ["convert", "meet", "duration"]) {
    await page.locator(`[data-view="${view}"]`).click();
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        scan.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })),
        `${view} in ${theme}`
      ).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.locator("#view-select").selectOption("meet");
  await expect(page.locator("#view-meet")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
