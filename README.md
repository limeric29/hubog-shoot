# Hubog Shoot

A product-photo studio for small sellers in the Philippines. You upload one phone photo and describe the product in English, Filipino or Taglish. A Muse Spark agent plans the shoot, Muse Image renders the listing photos and promo creatives, and SAM 3.1 cleans up the product with a tap. You download a pack sized for Shopee, Lazada, TikTok Shop and Facebook, with captions.

*Hubog* means "to shape" in Filipino.

## Built for the Meta Global AI Developer Hackathon

Hubog Shoot is being built from zero during the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Oct 26 – Nov 4, 2026), Indie Developer track, theme "Build for Your World". The first commit is Oct 27, 2026, and every line of code in this repo was written during the event.

**Prior work:** the name Hubog comes from the author's existing product at hubog.app. No code, prompts or assets from it are used here.

The plan, the schedule and the rules checklist are in [docs/PLAN.md](docs/PLAN.md).

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
npm run dev
```

## License

MIT
