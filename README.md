# Hubog Shoot

A product-photo studio for small sellers in the Philippines. You upload one phone photo and describe the product in English, Filipino or Taglish. A Muse Spark agent plans the shoot, Muse Image renders the listing photos and promo creatives, and SAM 3.1 cleans up the product with a tap. You download a pack sized for Shopee, Lazada, TikTok Shop and Facebook, with captions.

*Hubog* means "to shape" in Filipino.

**Live:** https://shoot.hubog.app

## Built for the Meta Global AI Developer Hackathon

Hubog Shoot is being built from zero during the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Oct 26 – Nov 4, 2026), Indie Developer track, theme "Build for Your World". The first commit is Oct 27, 2026, and every line of code in this repo was written during the event.

**Prior work:** the name Hubog comes from the author's existing product at hubog.app. No code, prompts or assets from it are used here.

The plan, the schedule and the rules checklist are in [docs/PLAN.md](docs/PLAN.md).

## How it works

1. **Brief.** One phone photo, plus a description typed or spoken in English, Filipino or Taglish.
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

Requires Node 22.9 or later and a [Meta Model API](https://dev.meta.ai/) key.

```bash
npm install
cp .env.example .env.local   # then add MODEL_API_KEY
npm run smoke                # checks every model, costs about $0.02
npm run dev                  # http://localhost:3000
```

## Deploy

The app runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Meta key is a Worker secret, never a file in the repo.

```bash
npm run cf:build
npx wrangler deploy --secrets-file <file containing MODEL_API_KEY=...>   # first deploy only; delete the file after
npx wrangler secret put MODEL_API_KEY                                    # later changes to the key
npm run cf:deploy                                                        # later deploys
```

One full run costs about $0.15–0.30 of Meta credit. Set `HUBOG_KILL=1` to pause every paid call and `SPEND_CAP_USD` to stop at a total. Each paid call also writes a `{"t":"spend",...}` line to the server log.

## License

MIT
