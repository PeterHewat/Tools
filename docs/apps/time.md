# Time

Convert Unix timestamps and ISO dates across time zones, find a call time for people in several
zones, and measure durations and ages.

Three views share the same time-zone field and date controls: **Find a time**, which a new tab
opens on, **Convert** and **Duration**. Zones are named IANA zones (`Europe/Paris`), read from the browser's own copy of
the [time-zone database](https://www.iana.org/time-zones) through `Intl`, so every offset is the
one at that date, fractional hours and daylight-saving time included. A zone can be typed by
name in any case or by its city alone. "Now" is the device clock, as exact as its setting; it is
not an independently synchronised clock like [Time.is](https://time.is/).

Dates are `YYYY-MM-DD` and times of day are on the 24-hour clock, shown and typed, whatever the
browser's language. Each is typed in a field of its own, a date as `2026-10-13` (or `2026-10-5`,
`20261013`) and a time as `14:30` (or `1430`, `9:30`), since native date and time fields would
follow the language into `10/13/2026` and AM/PM; a field is written out in full when it is left,
and marked while it cannot be read. What is typed stays in the tab's draft, saved as typing pauses
and as the page is left; a reload shows the view it was on, and Suggestions folded or not, from
the first paint (a script in the page's head reads the draft before the body is drawn). People, windows and pinned zones are kept in the browser. The calendar is the
proleptic Gregorian one, with year 0 for 1 BC.

## Find a time

Each person has a name, a zone, and windows on their own wall clock: **preferred**,
**acceptable** or **unavailable**. Time outside every window is unavailable. Where windows
overlap, unavailable wins over preferred, and preferred over acceptable. A window whose end is not
after its start runs past midnight; one that ends where it starts is the whole day. Weekly windows
apply on the weekdays ticked; a date exception replaces the windows that start on that date, and
with none the person is unavailable that day. A window is two lines: its days, with the button
that removes it in the corner, then its hours and level. A person's card folds to their name and
zone with the chevron at the end of its row; the red bin beside the chevron removes them, folded
or not. A new person keeps business hours, preferred from 09:00 to 17:00 on weekdays; the first
visit opens on two such people, Alex in Paris and Sam in New York, who overlap for two hours.

The search covers up to 31 days, from midnight to midnight in the zone the results are shown in,
for a call of 15 minutes to 3 hours. Windows are resolved date by date in each person's zone, so a
recurring evening follows that person's daylight-saving changes. A window covers the real time when
that person's clock reads inside it: where the clocks go back, a window in the repeated hour is
there twice and the time between is not; where they go forward, the part in the skipped hour does
not exist. Starts are a quarter hour apart, and the whole call must fit, both in everyone's windows
and before the end of the last day. A run of starts that cost everyone the same is one suggestion
("or start any time until 20:00"). While anyone's zone is unknown, no times are suggested: they
would read as times that suit everyone.

Ranking: a person's cost is the minutes of the call outside their preferred windows. Times that
need nobody's unavailable time come first; then the fewest unavailable minutes any one person
gives up, and in total; then the most minutes any one person spends outside preferred hours, so
nobody bears a large compromise to spare the group a small one; then the group's total; then the
earliest. Each suggestion gives everyone's own clock at the start, with their date where it is
not the one shown, and says why: "Sam: 1 h outside preferred hours; everyone else: preferred."
Suggestions are open to begin with and fold to their heading and count, from the heading's button
or anywhere on its row.

Unavailable time is used only for someone whose "Allow unavailable time" is on. When nothing fits,
the search names anyone with no stretch long enough of their own, and each person without whom the
others would find times, with a button to allow that person's unavailable time.

The timeline shows one day in the chosen zone: a row for everyone combined and one a person, all
aligned to the same instants, each with that person's own hours and date changes above it.
Preferred and acceptable are coloured, unavailable is hatched, and each row also reads as text
for a screen reader. The call is placed on the best suggestion, and stays there as people and
windows change, until someone places it themselves: choosing a suggestion, clicking the timeline
or typing a time. New dates to search or an opened share link put it back on the best suggestion.
The placed call says how it sits with everyone and gives a summary to copy, with each person's
own date and time.

Share link copies a link holding the people, their windows and the call length: JSON, compressed
with `deflate-raw` where the browser can, in Base64url after `#plan=`. Nothing is sent to a
server. Opening one asks whether to replace the saved people, add to them, or dismiss it, and says
it is a snapshot of what was entered, not live answers. The saved people (`tools.time.plan`) and
the share link are one format, read field by field, and versioned for a change that cannot be.
A plan or link from a later version of Time is not read as this one: the page says so, and leaves
the saved people as they are.

## Convert

The input takes a Unix timestamp, an ISO 8601 / RFC 3339 date (extended or basic, with an
optional `[Zone/Name]` suffix), or an HTTP or email date (RFC 9110, RFC 2822). A number from
100,000,000,000 up is read as milliseconds and below that as seconds; the note says which.
Seconds or Milliseconds writes each timestamp typed in that unit, the same instant (1760264100
becomes 1760264100000), and reads what is typed after in it. Digits past milliseconds are dropped,
and the note says so.

A date or time without an offset is read in the chosen zone, and a date alone at 00:00 there; the
note states the assumption. Where clocks go back, a time happens twice and nothing is shown until
the person chooses the first or second; where they go forward, it never happens, and it is read
as the time on the clock after the change (02:30 in a one-hour gap is 03:30), with the reason.
A date field and a time field write the input as they are typed, and follow it. Now writes the
current time in the unit chosen: Unix seconds, or milliseconds when Milliseconds is pressed.

Results give Unix seconds and milliseconds, UTC, the device's zone, the zone the input was read in
and each pinned zone (New York, London and Tokyo until changed), as ISO 8601 with the offset and
abbreviation at that instant and as the reader's language writes it, plus an HTTP date and a
relative time ("in 3 hours") that keeps up with the clock. Each has a copy button.

Several lines convert together into a table (label, input, Unix seconds, UTC, the chosen zone, a
note), copied as tab-separated text. A line may start with a label, `exp: 1760264100`, or be a
JSON member, `"exp": 1760264100,`. A time that happens twice is not guessed in a table: the line
asks for an offset. JWT's payload card opens Time on the token's `exp`, `iat` and `nbf`.

## Duration

From and To are each a date, with an optional time, or Now; To starts on Now, so "how old am I?"
and "how long since we met?" need only the first date, and "how long until my holiday?" switches
From to Now. Only one end can be now: switching one on switches the other back to its date. A
time is optional: without one, 00:00 in the chosen zone is assumed, and the note says so.
Ambiguous and skipped times are resolved as in Convert.

Calendar counts whole years, months and days on the wall clock, then the time left when every
dated end has a time. A day of 23 or 25 hours at a clock change is still one day. A month too
short for the day ends at its last day: one month after 31 January is 28 or 29 February, and a
29 February birthday counts on 28 February in other years. From a date in the past to now, it
also says when that date next comes round: "37 years on 14 Mar 2027, in 152 days". With one end
now otherwise, it gives the other end and how far off it is.

Elapsed gives the whole span in days, in hours, in minutes and in seconds of exact time, each on
its own, a day being 24 hours. Completed counts only whole units, toward zero for a negative span;
Nearest rounds to the nearest whole unit, half away from zero. While one end is now, both count
live, every second.

## Later

- Batch conversion of a pasted file or CSV column.
- A shareable snapshot as a file, for availability too large for a link.
- Find a time across more than 31 days, or with a start step other than a quarter hour.
