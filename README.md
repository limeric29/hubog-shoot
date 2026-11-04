# Hubog Shoot

A product-photo studio for small sellers in the Philippines. You upload one phone photo and describe the product in English, Filipino or Taglish. A Muse Spark agent plans the shoot, Muse Image renders the listing photos and promo creatives, and SAM 3.1 cleans up the product with a tap. You download a pack sized for Shopee, Lazada, TikTok Shop and Facebook Marketplace, with captions.

*Hubog* means "to shape" in Filipino.

**Live:** https://shoot.hubog.app

## Built for the Meta Global AI Developer Hackathon

Hubog Shoot is being built from zero during the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Oct 26 – Nov 4, 2026), Indie Developer track, theme "Build for Your World". The first commit is Oct 27, 2026, and every line of code in this repo was written during the event.

**Prior work:** the Hubog name, original logo and icons, palette, and type system come from the author's existing product at hubog.app. The Shoot descriptor and studio layout were created for this project. No application logic or model prompts are copied from hubog.app. The site uses the original Hubog lockup unchanged with a separately rendered Shoot descriptor. Fonts are third-party assets under the SIL Open Font License, included alongside the font files.

The plan, the schedule and the rules checklist are in [docs/PLAN.md](docs/PLAN.md).

## How it works

1. **Brief.** One phone photo, plus a description typed or spoken in English, Filipino or Taglish. JPEG, PNG, WebP, and HEIC/HEIF photos work; unsupported HEIC browsers convert the image on the device.
2. **Plan.** Muse Spark reads the photo and plans five shots (main, two lifestyle scenes, a close-up, a vertical promo) as JSON, with captions and a listing in the seller's language.
3. **Shoot.** Muse Image renders each scene with the seller's photo as the reference.
4. **Check.** Muse Spark compares each shot with the real photo: same shape, colour and label text? A shot that changed the product is reshot once. If it fails again, the scene is regenerated empty and the seller's real cutout is placed in it.
5. **Cutout.** SAM 3.1 cuts the real product out of the photo for the white-background main image. If it finds nothing, tap the product to outline it (with undo).
6. **Pack.** One zip with every image, every generated video, and the listing text. Generated scenes are labelled "AI-made scene".
7. **Animate (optional).** Any scene becomes a 5-second video: Muse Spark Open directs the motion, voice, and music bed from the frame, and LTX-2.5 renders picture plus native voiceover on a Modal B300.

## Meta models used

| Step | Model |
|---|---|
| Voice brief (code-switched Taglish) | Muse Voice Transcribe 1.0 |
| Shot plan, follow-up questions, quality check | Muse Spark 1.3 (image understanding, structured output) |
| Listing photos and promo creatives, refine by text | Muse Image 1.0 |
| Tap-to-select product mask, background cleanup | SAM 3.1 |
| Animation direction (motion, voice design, music bed) | Muse Spark Open (`meta-models/muse-spark-open-1026` on Baseten, falling back to Spark 1.3) |
| 5-second video + native voiceover + music | LTX-2.5 on Modal B300 (`modal/animate.py`) |

## Run it

Requires Node 22.9 or later, a [Meta Model API](https://dev.meta.ai/) key, and a Cloudflare Turnstile widget.

```bash
npm install
cp .env.example .env.local   # add MODEL_API_KEY and Turnstile keys
npm run smoke                # checks every model, costs about $0.02
npm run dev                  # http://localhost:3000
```

Model IDs are read from server environment variables. The defaults are `muse-spark-1.3`, `muse-image-1.0`, `sam-3.1`, and `muse-voice-transcribe-1.0`; change `MUSE_SPARK_MODEL`, `MUSE_IMAGE_MODEL`, `SAM_MODEL`, or `MUSE_VOICE_TRANSCRIBE_MODEL` in `.env.local` or `wrangler.jsonc`. `META_API_BASE_URL` can point to another compatible endpoint. If the selected models have different rates, update the `*_USD_*` pricing variables too so the spend log and cap stay accurate.

Muse Spark (shot planning and photo checks) can run on a separate endpoint: set `MUSE_SPARK_BASE_URL` and `MUSE_SPARK_API_KEY`. Spark usage is then billed to that endpoint, not Meta, so it doesn't count toward `SPEND_CAP_USD`. Single calls can also go to an open-weights endpoint: `MUSE_SPARK_OPEN_BASE_URL`/`MUSE_SPARK_OPEN_MODEL` (same key). Production plans and checks on Meta's `muse-spark-1.3` and directs animations with Baseten's `meta-models/muse-spark-open-1026`, falling back to 1.3 when the open call has issues.

Turnstile is off during development and on in production. Set `TURNSTILE_ENABLED=false` locally to disable it; the production Worker config enables it for `shoot.hubog.app`.

Any finished scene can be animated into a 5-second video: `modal/animate.py` is a separate Modal app running LTX-2.5 (first-frame conditioned, native voiceover dialogue plus a directed music bed) on a B300, exposed as start/status/result endpoints behind `ANIMATE_KEY`. Set `ANIMATE_URL` and `ANIMATE_KEY` (Worker secret in production) to enable the Animate button; without them the button still shows but reports the feature is not set up. Deploy or update it with `modal deploy modal/animate.py`.

Trying it is free: 3 shoots and 3 animations, then a free account keeps a daily quota. Abuse protection is Turnstile verification plus per-IP, per-account, and global daily caps (see `src/lib/server/auth.ts`).

## Deploy

The app runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Meta key is a Worker secret, never a file in the repo.

```bash
npm run cf:build
npx wrangler deploy --secrets-file <file containing MODEL_API_KEY=...>   # first deploy only; delete the file after
npx wrangler secret put MODEL_API_KEY                                    # later changes to the key
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put MUSE_SPARK_API_KEY                               # Baseten key for Spark Open direction
npm run cf:deploy                                                        # later deploys
```

Each photo shoot requires a verified Turnstile token; the server also checks the token's action and hostname, then gives the browser a one-hour signed session cookie for the image-generation calls.

With the default models and rates, one full run costs about $0.15–0.30 of Meta credit. Set `HUBOG_KILL=1` to pause every paid call and `SPEND_CAP_USD` to stop at a total. Each paid call also writes a `{"t":"spend",...}` line to the server log.

## License

MIT
