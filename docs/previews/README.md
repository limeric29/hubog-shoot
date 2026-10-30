# Studio layout previews

Generate all three screens from the real Studio and ShotCard components:

```sh
node scripts/preview-layouts.mjs --output-dir ..
```

This writes three self-contained HTML files with embedded fonts and sample photos:

- `hubog-shoot-layout-preview.html`: the product brief.
- `hubog-shoot-step-2-preview.html`: two photos ready, one checking, one shooting,
  and one queued; the listing sidebar shows a follow-up question.
- `hubog-shoot-step-3-preview.html`: all five photos ready, individual photo
  download links, the pack download control, and the completed listing.

Use the numbered header steps to move between them. These are layout previews:
typing, copying, reshooting, cutout editing, and ZIP generation require the app.
The static pages contain no application JavaScript and make no model API calls.
Individual photo links download the embedded sample image.

The generator seeds state only in a temporary copy, compiles Tailwind ahead of an
isolated webpack build, and exports the prerendered markup with its real styles.
It does not add preview routes or fixture handling to the application. The
calamansi images come from this project's earlier smoke run. The copy and
follow-up question are illustrative sample content from `studio-fixture.json`.
