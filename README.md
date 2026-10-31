# Hubog Shoot

A product-photo studio for small sellers in the Philippines. You upload one phone photo and describe the product in English, Filipino or Taglish. A Muse Spark agent plans the shoot, Muse Image renders the listing photos and promo creatives, and SAM 3.1 cleans up the product with a tap. You download a pack sized for Shopee, Lazada, TikTok Shop and Facebook, with captions.

*Hubog* means "to shape" in Filipino.

**Live:** https://shoot.hubog.app

## Built for the Meta Global AI Developer Hackathon

Hubog Shoot is being built from zero during the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Oct 26 – Nov 4, 2026), Indie Developer track, theme "Build for Your World". The first commit is Oct 27, 2026, and every line of code in this repo was written during the event.

**Prior work:** the Hubog name, original logo and icons, palette, and type system come from the author's existing product at hubog.app. The Shoot descriptor and studio layout were created for this project. No application logic or model prompts are copied from hubog.app. A generated logo exploration and its prompt are recorded in `docs/brand`; the site uses the original Hubog lockup unchanged with a separately rendered Shoot descriptor. Fonts are third-party assets under the SIL Open Font License, included alongside the font files.

The plan, the schedule and the rules checklist are in [docs/PLAN.md](docs/PLAN.md).

## How it works

1. **Brief.** One phone photo, plus a description typed or spoken in English, Filipino or Taglish. JPEG, PNG, WebP, and HEIC/HEIF photos work; unsupported HEIC browsers convert the image on the device.
2. **Plan.** Muse Spark reads the photo and plans five shots (main, two lifestyle scenes, a close-up, a vertical promo) as JSON, with captions and a listing in the seller's language.
3. **Shoot.** Muse Image renders each scene with the seller's photo as the reference.
4. **Check.** Muse Spark compares each shot with the real photo: same shape, colour and label text? A shot that changed the product is reshot once. If it fails again, the scene is regenerated empty and the seller's real cutout is placed in it.
5. **Cutout.** SAM 3.1 cuts the real product out of the photo for the white-background main image. Tap to add or remove parts.
6. **Pack.** One zip with every image and the listing text. Generated scenes are labelled "AI-made scene".

## Meta models used

| Step | Model |
|---|---|
| Voice brief (code-switched Taglish) | Muse Voice Transcribe 1.0 |
| Shot plan, follow-up questions, quality check | Muse Spark 1.3 (image understanding, structured output) |
| Listing photos and promo creatives, refine by text | Muse Image 1.0 |
| Tap-to-select product mask, background cleanup | SAM 3.1 |

## Run it

Requires Node 22.9 or later, a [Meta Model API](https://dev.meta.ai/) key, and a Cloudflare Turnstile widget.

```bash
npm install
cp .env.example .env.local   # add MODEL_API_KEY and Turnstile keys
npm run smoke                # checks every model, costs about $0.02
npm run dev                  # http://localhost:3000
```

Model IDs are read from server environment variables. The defaults are `muse-spark-1.3`, `muse-image-1.0`, `sam-3.1`, and `muse-voice-transcribe-1.0`; change `MUSE_SPARK_MODEL`, `MUSE_IMAGE_MODEL`, `SAM_MODEL`, or `MUSE_VOICE_TRANSCRIBE_MODEL` in `.env.local` or `wrangler.jsonc`. `META_API_BASE_URL` can point to another compatible endpoint. If the selected models have different rates, update the `*_USD_*` pricing variables too so the spend log and cap stay accurate.

Turnstile is off during development and on in production. Set `TURNSTILE_ENABLED=false` locally to disable it; the production Worker config enables it for `shoot.hubog.app`.

## Deploy

The app runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Meta key is a Worker secret, never a file in the repo.

```bash
npm run cf:build
npx wrangler deploy --secrets-file <file containing MODEL_API_KEY=...>   # first deploy only; delete the file after
npx wrangler secret put MODEL_API_KEY                                    # later changes to the key
npx wrangler secret put TURNSTILE_SECRET
npm run cf:deploy                                                        # later deploys
```

Each photo shoot requires a verified Turnstile token; the server also checks the token's action and hostname, then gives the browser a one-hour signed session cookie for the image-generation calls.

With the default models and rates, one full run costs about $0.15–0.30 of Meta credit. Set `HUBOG_KILL=1` to pause every paid call and `SPEND_CAP_USD` to stop at a total. Each paid call also writes a `{"t":"spend",...}` line to the server log.

## License

MIT
