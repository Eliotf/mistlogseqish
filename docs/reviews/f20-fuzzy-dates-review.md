# Review guide: F20, fuzzy dates

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f20-fuzzy-dates-review.md`.

## What it does

Type a phrase and link to that day's journal (PRD 6.2):

- **`@` trigger.** `@` at the start of a line or after a space opens a list of days for the phrase typed after it (`@next fri`, `@in 2 weeks`). Enter or Tab writes `[[Nov 3rd, 2026]]`, linked to `journal-2026-11-03`. If nothing matches, a note says so. Escape closes the list and leaves the text.
- **`@` stays plain text** inside an email address, after `@ ` (a space straight after it), inside a link, and in suggest mode.
- **`[[` suggestions** list up to three matching days below the pages, for links only (not tags). A day already listed as a page isn't repeated.
- **Phone:** the toolbar has an `@` button. After a word, it types a space first.
- **No document format change.** A date link is an ordinary link to a journal ID, and the journal is made when it first gets text, as before.

## Meanings (from the prototype)

- `friday`, `this friday` and `next friday` all mean the coming Friday, never today. `last friday` is the one before today.
- `in N days/weeks/months`. Months keep the day of the month, or use the month's last day when it is shorter: Jan 31 + 1 month is Feb 28th.
- `oct 31` and `31st october` mean this year's date, or next year's once it has passed. `feb 29` finds the next leap year.
- Short names are accepted: `fri`, `sept`.
- Each day is listed once.

## Decisions

- **The week-start setting (6.2) is deferred.** None of the listed phrases depends on it. It comes with a phrase that does, such as `next week`. Recorded in the PRD.
- **"next friday" follows the prototype:** the coming Friday. Some tools read it as the Friday of next week. The PRD decision row records the choice.

## What changed

| File | What |
|---|---|
| `app/lib/fuzzy-dates.ts` | **New**, pure. `resolvePhrase`, `dateSuggestions` |
| `app/lib/date-trigger.ts` | **New** extension `DateTrigger`, and `dateQuery` |
| `app/lib/link-suggestions.ts` | `date` items (the day, plus its phrase in grey), a "no match" note, and a list label |
| `app/lib/wikilink-editing.ts` | Date items in `[[` suggestions; a `today` option |
| `app/lib/phone-actions.ts`, `app/components/PhoneToolbar.tsx` | The `date` action and the `@` button |
| `app/components/Editor.tsx`, `app/app.css` | Registration and styles |
| Tests | Parser (12, covering month, year, leap-year and daylight-saving boundaries), `@` and `[[` in a real editor (11), toolbar (1 updated for the new button) |

## Deliberate breaks

17 tried, all caught, including:
- weekdays allowed to be today;
- months overflowing;
- a passed date kept in this year;
- impossible days accepted;
- duplicate days, and no caps;
- `@` after a letter;
- suggest mode;
- `@ ` staying open;
- Escape or blur not closing the list;
- dates offered for tags;
- a listed day repeated.

Two breaks first survived, and I fixed both:
- **The `@` extension's own title request:** removing it went unnoticed, because the request is redundant. The link extension already asks for every link's title, so I removed it.
- **The `[[` cap of three:** the test didn't exercise it, so I added a test with `[[last`, where seven days match.

## Walked through (local dev server, headless Chrome)

- **`@in 2 weeks`** offered Nov 25th, 2026 (today was Nov 11th), and Enter linked it. Nov 25th's page showed the backlink.
- **An email address** didn't open the list.
- **`@soon`** showed the "no match" note, and Escape left the text.
- **`[[next fr`** listed "Nov 13th, 2026, next friday" below the pages.
- **The console** showed no errors.
- **Mishap:** the walkthrough typed into the local journal for today, because `GET /new` redirects to the feed. I cleared it afterwards and added a gotcha line about it to AGENTS.md.

## Worth a careful look

- **Key priority.** `DateTrigger` is priority 200, so its arrows and Enter come before the link extension's. Its list and the `[[` list can't both be open, since `@` doesn't trigger inside a link.
- **Closing the list.** It closes, and stays closed, once the cursor leaves the phrase, the `@` is deleted, the phrase passes 24 characters, the line changes, or the editor loses focus.
