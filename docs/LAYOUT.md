# Shoot layout

The studio serves small Filipino sellers preparing product listings from a phone
photo. Its primary job is to get a seller from their own photo to a downloadable
pack, with a clear distinction between their real product and AI-made scenes.

## Design plan

- Cloud White `#F7F9FD`: the surrounding workspace.
- White `#FFFFFF`: controls and photo mounts.
- Midnight Navy `#080F28`: the wordmark, headings, and primary actions.
- Accessible Blue `#0B5ED7`: small action text and current steps.
- Pale Blue `#E6F1FF`: the sample pack and supporting highlights.
- Border `#E1E5F2`: section boundaries; fields use the stronger `#8087AE`.

Plus Jakarta Sans handles headings and the Shoot descriptor; Inter handles
instructions and controls. Both match the existing Hubog identity. The original
Hubog gradient icon and lowercase wordmark are used unchanged. The Shoot
descriptor is framed with Electric Blue `#1677FF` viewfinder corners. Leave at
least one-third of the icon height as clear space around the master logo.

The identity follows `hubog.app/docs/design-handoff`, its component reference, and
`hubog.app/src/styles/tokens.css`. The earlier custom camera wordmark, lilac
palette, and unrelated fonts have been replaced with the established brand.

The layout puts the brief directly beside an actual example pack, rather than
asking sellers to scroll through a marketing hero and generic feature cards.
The contact sheet provides the expressive element; the controls stay quiet.

```text
Desktop
Brand                                  Three steps
Your product. Ready for its close-up.   Short explanation
┌──────────────────────────┬────────────────────────────┐
│ 1  Product photo         │ Example pack                │
│    Upload                │     Lifestyle   Main image  │
│ 2  Product details       │                 Promo       │
│    Text / voice          │ Five photos + listing text  │
│    Make my photos        │ Shopee / Lazada / social    │
└──────────────────────────┴────────────────────────────┘

Results
Product + original photo               Pack download
┌──────────────────────────────────┬────────────────────┐
│ Photo contact sheet              │ Listing copy       │
│ Per-photo status and controls    │ Follow-up question │
└──────────────────────────────────┴────────────────────┘

Mobile
Brand / compact steps
Short headline
Photo / details / action
Example pack (collapsible)
Results: summary / download / photos / listing
```

The example uses assets generated during this project's earlier smoke run, resized
for the preview. It is labelled as an example and its AI-made scenes are disclosed.
Numbers describe the actual input sequence. Borders group tasks, while photo mats
distinguish the different image proportions without cropping the delivered photos.

Fonts are bundled locally from the Google Fonts source repository, with each
family's SIL Open Font License in `src/app/fonts`. Builds do not fetch fonts.

The logo exploration, generation prompt, and distinction between the bitmap
concept and the exact-brand header treatment are recorded in `docs/brand/README.md`.

## Verification

The three offline screens can be regenerated with `node scripts/preview-layouts.mjs`.
See `docs/previews/README.md` for the sample states and review controls.

Run lint, TypeScript, and the production build. In a connected browser, check
390 px and 1440 px widths, upload and keyboard focus, planning, partial/final
results, failed shots, copying text, and pack download. Respect reduced motion.
