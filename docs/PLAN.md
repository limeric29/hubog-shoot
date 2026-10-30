# Build plan: Oct 27 – Nov 4, 2026

Hubog Shoot is being built from zero for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon), Indie Developer track, theme "Build for Your World". All times are Manila time (PHT, UTC+8) unless marked ET.

## The user and the job

**User:** a home-based seller in the Philippines who sells on Shopee, Lazada, TikTok Shop or Facebook Marketplace, shoots products on a phone, and can't pay a photographer or an agency.

**Job:** turn one phone photo and a few words (typed or spoken, in English, Filipino or Taglish) into a ready-to-post set of listing photos and promo creatives, with captions, in about five minutes.

**Done looks like:** a seller in Davao takes their own product from photo to a downloaded listing pack on their phone, without help, and says they'd post it.

## The flow

1. **Brief.** The seller uploads a phone photo and describes the product, by typing or by voice. Voice goes through **Muse Voice Transcribe**, which handles code-switching.
2. **Plan.** **Muse Spark 1.3** reads the photo and the description. It returns a shot plan as structured output: 4–6 shots, each with platform, aspect ratio, scene, props, light and a caption idea. It asks one follow-up question only when something important is missing, such as the price or the selling point.
3. **Shoot.** **Muse Image** renders each shot with the seller's photo as the reference. The seller can refine a shot in plain words ("gawing mas maliwanag", "ilagay sa mesa"), and each refinement is a new turn on the Responses API.
4. **Cutout.** **SAM 3.1** finds the product from the name Muse Spark gave it, and the app builds the white-background main image (the marketplace standard) from the seller's own pixels. If SAM picks the wrong thing, the seller taps to add or remove parts, and SAM redraws after every tap (one tap selects only the part under it, so a fix takes a few).
5. **Check.** Muse Spark compares each finished shot with the original photo. Is it the same product, with the same label, colour and shape? Is any text readable? A failed shot gets one automatic redo, and each rejected try is shown to the seller with the reason. If the redo fails too, the scene is regenerated without the product and the seller's real cutout is placed in it, so the pack never contains a product the seller doesn't have.
6. **Publish.** The seller downloads a pack sized per platform: 1:1 main image, 4:5 feed, 9:16 story. Captions and hashtags come in their language.

## Stack

- Next.js 16.4.3 (App Router) and React 19.3, TypeScript 5.9, Tailwind 4. Every version is pinned exactly and the lockfile is committed.
- Meta Model API through the OpenAI SDK (`openai` 7.45.0) at `https://api.meta.ai/v1`, plus `@meta-sam/parser` 0.1.0 for SAM output.
- Hosting: Cloudflare Workers through OpenNext, live since Oct 31 at https://shoot.hubog.app (also hubog-shoot.hubog.workers.dev). The Meta key is a Worker secret; `SPEND_CAP_USD` and `HUBOG_KILL` are Worker vars.
- Mobile-first UI, because sellers are on phones.

## Day by day

| Day | Date (PHT) | Goal | Done when |
|---|---|---|---|
| 1–4 | Tue Oct 27 – Fri Oct 30 | Repo, API proof, then the whole flow | **Done Oct 30.** A photo and a Taglish or voice brief become five checked shots, a real-product cutout and a zip pack in about 60 seconds, on all four Meta models |
| 5 | Sat Oct 31 | Live URL, refine by text, harder products | The app is on a public URL with the spend cap and visitor limits working; a seller can refine a shot in plain words (Muse Image multi-turn); three harder products (printed pouch, skincare tube, small jewellery) tested, with the failures written down; 2–3 sellers have agreed to try it |
| 6 | Sun Nov 1 | Real sellers | 2–3 sellers run it on their own products on their own phones; top problems written down |
| 7 | Mon Nov 2 | Fix what they hit | The top problems from Day 6 are fixed; errors, retries and rate limits are exercised; the README explains the architecture |
| 8 | Tue Nov 3 | Demo video + form | 3-minute video with voiceover recorded and edited; the submission form drafted; the X post drafted |
| 9 | Wed Nov 4 | Submit | Submitted by **8 PM PHT Wed Nov 4**; X post up; the community vote link shared |

**Hard deadline:** Wed Nov 4, 9:00 PM ET = **Thu Nov 5, 10:00 AM PHT**. Late entries aren't accepted.

## Live sessions

US clocks go back on Sun Nov 1, so ET-based times shift an hour later in Manila from then on.

- Agents 101: Wed Oct 28, 12:00 AM PHT
- Agents 102 (verifiable agents): Thu Oct 29, 12:00 AM PHT. Relevant to the Check step.
- Fireworks workshop: Sat Oct 31, 12:00 AM PHT
- Meta office hours in Discord `#office-hours`: weekdays 10–11 PM PHT until Oct 30, then 11 PM – midnight from Nov 2
- Tue Nov 3 ET is the last full day for submission questions.

## Prizes we're aiming at

- **Indie Developer track**, judged on Impact, Use of Meta AI tooling, Technical depth and Demo, each 0–10.
- **Best Creative Build** ($5K): built on Muse Image.
- **Best Agentic Use-Case** ($5K): the plan, shoot, check and redo loop.
- **Most Viral** ($20K): the demo posted on X, with engagement counted to Nov 8. The post link goes in the submission form.
- **Community Vote** ($10K): the gallery link shared after submission, with the winner announced Nov 16.
- Stretch, only if partner credits arrive: route caption writing through Muse Spark Open on Baseten (`meta-models/muse-spark-open-1026`) for **Best Build on Meta Open Weight Models** ($10K).

Name every bonus prize on the submission form. They aren't picked up automatically.

## Budget

The $150 Meta Model API credit covers the build. Standard-mode list prices:

| Model | Price | One shoot uses about |
|---|---|---|
| Muse Spark 1.3 | $1.25 / $4.25 per 1M tokens in / out | $0.02–0.05 |
| Muse Image 1.0 | $0.01 per image | 6 shots × up to 3 tries = $0.18 |
| SAM 3.1 | $2.50 per 1,000 images | under $0.01 |
| Muse Voice Transcribe | $0.18 per hour of audio | under $0.01 |

So one full shoot costs roughly $0.20–0.30.

- Building and testing: cap at $90.
- Live demo for judges and the community vote: keep $60 in reserve. Limit each visitor to a few shoots a day, set a global daily cap, and add a kill switch in an env var.
- Every API call writes a spend-journal row (model, units, estimated cost). Quote spend from the journal, not from memory.
- Set a spend limit on the dev.meta.ai Billing page, because the card on file pays past $150.

## Rules checklist (Indie)

- [ ] Repo is public.
- [ ] Every line of code is written during the event. The first commit is Oct 27, and no Hubog code is copied in.
- [ ] Prior work is called out in the README and submission. The only one is the Hubog name, which belongs to the owner's existing product; no code is shared.
- [ ] The demo shows only what was built here.
- [ ] The 3-minute demo video is public, with a voiceover.
- [ ] Nothing on the avoid list: no plain chat wrapper, no simple image analyzer, nothing medical or political.
- [ ] Generated images are labeled as AI-made in the pack, and the Check step blocks shots that misrepresent the product.

## Risks

- **Product fidelity.** Muse Image may change the product. Mitigations: pass the seller's photo as a reference image; for the main image, place the real SAM cutout on the generated background instead of regenerating the product; let the Check step catch the rest.
- **Latency.** Muse Image searches the web by default. Image and web search are off for product shots: it stops other brands' imagery leaking in. A full run takes about 60 seconds.
- **Image sizes.** Muse Image accepts only 1:1, 2:3 and 3:2 (other sizes are a 400). 4:5 and 9:16 shots are generated at 2:3 and cropped in the browser.
- **Voice format.** Muse Voice Transcribe takes WAV only, so the browser records, decodes and re-encodes to 16 kHz mono WAV before upload.
- **Country availability.** Some models are restricted by country (see the Geographic Use Policy). The Day 1 smoke test from Manila confirms access.
- **Abuse on the live URL.** Per-visitor and daily caps, plus the kill switch, protect the credit.

## Demo video (3:00)

1. **0:00–0:20:** a Davao seller, one phone photo, no budget for a shoot.
2. **0:20–2:15:** a live run on a real product. Taglish voice brief → plan → shots → tap to clean the main image → the Check step catches a bad shot and redoes it → download the pack.
3. **2:15–2:45:** how it works. Which Meta model does what, and what was built during the event.
4. **2:45–3:00:** the live link and the X handle.
