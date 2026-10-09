# Time

Not built yet. Status and build order are on the [roadmap](../README.md).

Purpose: convert times, compare availability and measure durations. Three views share
the same date controls and time-zone picker: **Convert**, **Find a time**, and **Duration**.

## Convert

Initial scope:

- Unix timestamps in seconds or milliseconds, with explicit units. Detection may suggest
  a unit, but people can see and override it.
- ISO 8601 input/output, UTC, the browser's local zone and a few pinned named zones.
- Conversion in both directions, with copy buttons and a visible UTC offset for the date.
- Relative display such as "in 3 hours" as a supplement to the exact result.

Use named zones such as `Europe/Paris`, not a fixed list of 24 offsets. Zones can have
fractional-hour offsets, and their offsets depend on the date and daylight-saving rules.
The [IANA time-zone database](https://www.iana.org/time-zones) describes these rules.

A local time can occur twice or never occur when the clocks change. Explain that result
and require a choice for an ambiguous time rather than silently picking an instant.
Date-only and date-time inputs need visible assumptions about their zone and time.
Any "now" display uses the device clock; it should not promise an independently
synchronised exact clock like [Time.is](https://time.is/).

Small extension: batch timestamp conversion. A handoff from JWT's time claims would
also fit the existing pattern for opening another app on the same input.

## Find a time

Use case: one person enters their own and their friends' availability to find a convenient
call time across several zones, or the least inconvenient compromise when preferences
do not overlap. It works for two people or a group without accounts.

Inputs:

- A name and named time zone for each person.
- Multiple availability windows in each person's local time, including windows that
  cross midnight.
- Three levels: **preferred**, **acceptable**, and **unavailable**. Define the availability
  model so those levels are unambiguous; outside the entered windows is unavailable.
- A call duration and a date range to search.
- Reusable weekly patterns, with exceptions for individual dates.

Resolve weekly windows for each actual date before comparing them. A recurring local
evening window should follow that person's daylight-saving changes, not a frozen UTC offset.
The call's entire duration must fit, not just its start. Show the calendar date as well
as the clock time for each person when a candidate crosses a date boundary.

Results:

- A timeline with one row per person, aligned to the same instants, showing local times,
  preferences and shared availability.
- Ranked suggestions, with fully preferred overlaps first and acceptable compromises next.
- A plain explanation of each compromise, for example "Alice: 30 minutes past preferred
  hours; everyone else: preferred."

For compromise ranking, minimise the worst inconvenience for any one person first, then
use total inconvenience to break ties. This avoids making one person bear a large penalty
just to improve the group's total. The exact scoring rule remains to be defined; it should
be deterministic and understandable, and account for the whole call duration.

Unavailable periods remain excluded unless the person explicitly relaxes them. If no
candidate fits everyone's acceptable windows, show that result and identify which windows
prevent a match; offer relaxation as a deliberate action. Do not quietly schedule a call
during someone's excluded sleep or work hours.

Save people and patterns locally. Useful later additions are a shareable snapshot and a
copyable summary such as "Saturday: Paris 20:00 / New York 14:00". A snapshot represents
entered information, not live answers from friends; choose its sharing format separately.

Out of scope: accounts, collecting live availability from participants, calendar integrations,
invitations and an ongoing scheduling service.

## Duration and age

Make "How old am I?" a preset of a general duration calculator:

- A start date/time and optional end date/time, defaulting to now.
- Calendar age in years, months and days, or a total expressed in **days only**, **hours
  only**, **minutes only**, or **seconds only**.
- The same controls for "how long since we met?" or "how long until my holiday?"
- An optional live counter when the end is now.

Calendar age and elapsed duration are separate measurements. An elapsed day is 24 hours;
calendar days can span daylight-saving changes. Define and expose rounding for totals.
A birth date alone does not establish an exact age in seconds: allow a birth time and
zone, or visibly state the assumed time and zone. Resolve ambiguous inputs as in Convert.

## Decisions before implementation

- First-release scope for conversion, duration and basic availability overlap.
- Compromise scoring, duration rounding and calendar-age conventions.
- Portable file, URL snapshot or copied text for sharing availability.
