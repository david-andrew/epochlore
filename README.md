# Epochlore

A small browser/desktop app for planning and organizing timelines (for writing,
worldbuilding, history) backed by a plain, human-readable Markdown file.

Timelines render as horizontal lines you can pan and zoom; events are points and
spans you can add, edit, color, and annotate with Markdown. The underlying `.md`
file stays the source of truth — edit it in the app or in your own editor.

## The Markdown format

Each top-level heading (`#`) is a timeline; `##` headings are events (a single
point) or spans (a range). Metadata lines start with `>`. Example:

```markdown
# Earth 21st century
> id=CE
> epoch=2025

## [2025-07-13] Second contact
A faint repeating pulse is picked up by the array.

## [2026 .. 2030-10] The Quiet Years
> color=green

A long period of preparation and uncertainty.

## [2028-03-02 14:30:00] Launch window opens
```

- Dates go in `[...]`; a span is `[start .. end]`. Resolution goes down to the
  second (`YYYY-MM-DD HH:MM:SS`), and trailing parts are optional.
- `epoch=` sets the timeline's anchor; `id=` names its calendar.
- Custom calendars are supported via `months=Name:days,...` and `secondsPerDay=`.
- `color=` accepts a name or hex (`green`, `0xe6a15a`); omit it for a random color.
- Heading body text is the event/span note and is rendered as Markdown.

See [`sample.md`](sample.md) for a fuller sample.

## Running locally (two-way file sync)

The Python dev server reads and writes a `.md` file in place, so edits in the app
save straight back to disk (and external edits live-reload into the app):

```bash
python serve.py path/to/timeline.md
```

Then open http://127.0.0.1:8753/ (opens automatically). Requires Python 3.10+;
no dependencies.

## Using it in the browser (static hosting)

The app in `www/` is fully static and is deployed to GitHub Pages. Storage adapts
to the browser:

- **Chromium**: in-place editing of a local file via the File System Access API.
- **Firefox / Safari**: autosave to the browser, plus Import/Export buttons.

Either way you can grab the desktop app from the in-app **Desktop app** button or
the download page.

## Desktop app

Built with [Neutralino](https://neutralino.js.org/) from the same `www/` assets,
with native file access and offline use. To build locally:

```bash
neu update   # first time only, fetches the runtime binaries
neu build    # outputs per-platform binaries to dist/epochlore/
```

A binary plus its `resources.neu` (same folder) is all you need to run.

## Releases

The app version lives in [`neutralino.config.json`](neutralino.config.json)
(`"version"`). On push to `main`, CI deploys the web app to Pages; if that version
has no release yet, it also builds the desktop binaries and publishes a
`v<version>` GitHub Release. Running the workflow manually re-publishes the latest
`main` regardless of the version.

To cut a release: bump `"version"`, commit, and push.
