"""Animate a Hubog Shoot scene photo with LTX-2.5 on a B300.

Separate Modal app from the main hubog-ltx25 backend: one GPU class plus a small
authenticated web API. It attaches the existing `weights-ltx25` Volume, so no
weights are downloaded. First-frame image conditioning animates the seller's
chosen scene; the model also generates a matching ambience soundtrack.

Endpoints (all need `Authorization: Bearer $ANIMATE_KEY`):
  POST /start  {image_b64, prompt, aspect, duration_sec, camera, seed, headline?, title_style?} -> {call_id}
  GET  /status/{call_id} -> {status: running|done|error, ...}
  GET  /result/{call_id} -> the finished MP4 bytes

Deploy: modal deploy modal/animate.py   (from the hubog-shoot repo root)
Needs the Modal secret `hubog-shoot-animate-key` holding ANIMATE_KEY.
"""

import io
import os
import subprocess

import modal

APP_NAME = "hubog-shoot-animate"
REPO = "Lightricks/LTX-2.5"
FILES = {
    "transformer": "diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    "text_encoder": "text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    "video_vae": "vae/ltx-2.5-video-vae-bf16.safetensors",
    "audio_vae": "vae/ltx-2.5-audio-vae-bf16.safetensors",
    "spatial_upsampler": "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
}
# github.com/Lightricks/LTX-2 main (ltx-core / ltx-pipelines 1.4.2, the first
# with LTX-2.5 support; PyPI only has 1.0.0). Same pin as hubog-ltx25.
LTX_COMMIT = "be6d6d0a69d11a0a399c462ed92606692e5f8697"
FPS = 24
FRAMES = {5: 121, 10: 241, 15: 361}
# (width, height): multiples of 32, matching the seller's shot shapes.
SIZES = {"1:1": (960, 960), "4:5": (768, 960), "9:16": (704, 1280)}
GPU = "B300"
WEIGHTS_DIR = "/weights"
KEY_SECRET = modal.Secret.from_name("hubog-shoot-animate-key")

DEFAULT_MUSIC = "a light cheerful background music bed"


def audio_line(job: dict) -> str:
    """Ambience plus the director's music bed, kept under the voiceover."""
    music = str(job.get("music", "") or "").strip()[:120] or DEFAULT_MUSIC
    return f"Sound: natural ambience and foley for the scene, plus {music}."
NO_TEXT_LINE = "No on-screen text, captions or logos."
# LTX-2.5 cuts to new shots on cue, so product clips pin a single take.
# Prompt shape follows Lightricks' guide (docs.ltx.io, prompting-guide):
# one present-tense paragraph, motion + camera with end framing, no cuts.
TAKE_LINE = "A single continuous take with no cuts."
CAMERA_HINTS = {
    "slow_push_in": "The camera slowly pushes in, ending in a medium close-up with the product centered and fully in frame.",
    "static": "Static camera, locked-off shot; the product stays centered and fully in frame throughout.",
    "drift": "The camera drifts very gently sideways and settles with the product centered and fully in frame.",
}

app = modal.App(APP_NAME)
volume = modal.Volume.from_name("weights-ltx25", create_if_missing=False)

TORCH_INDEX = "https://download.pytorch.org/whl/cu132"
LTX_GIT = f"git+https://github.com/Lightricks/LTX-2.git@{LTX_COMMIT}#subdirectory=packages"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "ffmpeg", "fonts-dejavu-core")
    .uv_pip_install("torch==2.13.0", "torchvision==0.28.0", index_url=TORCH_INDEX)
    .uv_pip_install("torchaudio==2.11.0+cu132", index_url="https://download.pytorch.org/whl/test/cu132", extra_options="--no-deps")
    .uv_pip_install("natten==0.21.7+torch2130cu132", find_links="https://whl.natten.org")
    .uv_pip_install(
        f"ltx-core @ {LTX_GIT}/ltx-core",
        f"ltx-pipelines @ {LTX_GIT}/ltx-pipelines",
        "transformers==5.14.1",
        "accelerate==1.15.0",
        "safetensors==0.8.0",
        "av==19.0.1",
        "einops",
        "scipy",
        "colour-science==0.4.7",
        "openimageio==3.1.18.1",
        "pillow",
        "numpy",
    )
    # Upstream overrides torch's cuDNN 9.20, which aborts on the first cuDNN
    # SDPA call (see LTX-2's pyproject.toml).
    .uv_pip_install("nvidia-cudnn-cu13==9.24.0.43", extra_options="--no-deps")
    .env({"HF_HUB_DISABLE_TELEMETRY": "1", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
)
# NOTE: no ltx-kernels build here (unlike hubog-ltx25): NATTEN's auto-selected
# Blackwell kernel decodes a 5 s clip in ~4 s, plenty for one scene at a time.

web_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("fastapi[standard]")

with image.imports():
    import torch
    from ltx_core.loader.module_ops import ModuleOps
    from ltx_core.loader.registry import ModelRegistry
    from ltx_core.model.video_vae.transformer.compiling import configure_natten_backend
    from ltx_pipelines.distilled import DistilledPipeline
    from ltx_pipelines.utils.media_io import encode_video
    from ltx_pipelines.utils.model_paths import ModelPaths
    from ltx_pipelines.utils.types import ImageConditioningInput
    from PIL import Image


@app.function(image=image, volumes={WEIGHTS_DIR: volume}, timeout=120)
def check_weights():
    """CPU-only probe: fail fast with a clear message when the weights Volume is empty."""
    import pathlib

    root = pathlib.Path(WEIGHTS_DIR) / REPO
    missing = [v for v in FILES.values() if not (root / v).exists()]
    if missing:
        raise RuntimeError(f"{REPO} is incomplete on weights-ltx25; missing: {missing}")
    return {"ok": True, "files": len(FILES)}


def mux_audio(video_path: str, out_path: str, waveform, sampling_rate: int) -> None:
    """Mux a stereo float waveform into `video_path` as 192k AAC, cleaned and loudness-normalized."""
    wave = torch.nan_to_num(waveform.float(), nan=0.0, posinf=0.0, neginf=0.0).clamp(-1.0, 1.0)
    wave = wave.T if wave.shape[0] == 2 else wave
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", video_path, "-f", "f32le", "-ar", str(sampling_rate), "-ac", "2", "-i", "pipe:0",
         "-map", "0:v", "-map", "1:a", "-c:v", "copy",
         "-af", "loudnorm=I=-16:TP=-1.5,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out_path],
        input=wave.contiguous().cpu().numpy().tobytes(), check=True, capture_output=True,
    )


FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def drawtext_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("%", "\\%").replace("'", "\\'")


def wrap_headline(headline: str, font, max_width: float) -> list[str]:
    """Greedy word wrap mirroring the stills' drawHeadline (image.ts)."""
    from PIL import ImageDraw

    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    lines, line = [], ""
    for word in headline.split():
        nxt = f"{line} {word}".strip()
        if line and probe.textlength(nxt, font=font) > max_width:
            lines.append(line)
            line = word
        else:
            line = nxt
    if line:
        lines.append(line)
    return lines


def scrim_png(path: str, width: int, height: int) -> None:
    """Top gradient scrim mirroring the stills: black 50% fading to transparent."""
    from PIL import Image as PILImage

    h = max(1, height)
    col = PILImage.new("RGBA", (1, h), (0, 0, 0, 0))
    px = col.load()
    for y in range(h):
        px[0, y] = (0, 0, 0, round(128 * (1 - y / h)))
    col.resize((width, h)).save(path)


TITLE_ANCHORS = ("top", "center", "bottom")
TITLE_ANIMATIONS = ("fade", "rise", "slide")
TITLE_COLORS = ("white", "black")


def finish(video_path: str, out_path: str, headline: str, duration: float, width: int, height: int,
           title_style: dict | None = None) -> None:
    """Composite the animated headline over the clip; audio passes through.

    Without a directed style the headline mirrors the stills' drawHeadline
    exactly (0.085w bold, wrapped at 0.84w, top at 0.06h, gradient scrim). The
    director may move it (top/center/bottom), pick an entrance (fade/rise/slide)
    and flip it black over bright scenes. Fades in over 0.8 s, holds, fades out
    over the last 0.7 s. The voiceover is native LTX dialogue, already in the mix.
    """
    if not headline:
        os.replace(video_path, out_path)
        return
    from PIL import ImageFont

    style = title_style if isinstance(title_style, dict) else {}
    anchor = style.get("anchor") if style.get("anchor") in TITLE_ANCHORS else "top"
    animation = style.get("animation") if style.get("animation") in TITLE_ANIMATIONS else "fade"
    color = style.get("color") if style.get("color") in TITLE_COLORS else "white"
    shadow = "white@0.45" if color == "black" else "black@0.45"

    cmd = ["ffmpeg", "-v", "error", "-y", "-i", video_path]
    scrim_path = None
    size = line_height = top = 0
    lines: list[str] = []
    if headline:
        size = round(width * 0.085)
        font = ImageFont.truetype(FONT, size)
        lines = wrap_headline(headline, font, width * 0.84)
        line_height = size * 1.15
        block = len(lines) * line_height
        top = {"top": height * 0.06, "center": (height - block) / 2, "bottom": height * 0.94 - block}[anchor]
        if anchor == "top":
            scrim_path = "/tmp/scrim.png"
            scrim_png(scrim_path, width, round(top + block + size))
            cmd += ["-loop", "1", "-framerate", str(FPS), "-i", scrim_path]
    filters = []
    v_out = "0:v"
    fade_out = max(0.5, duration - 0.7)
    if headline:
        alpha = f"if(lt(t,0.8),t/0.8,if(gt(t,{fade_out:.2f}),({duration:.2f}-t)/0.7,1))"
        entrance = "1-t/0.8" if animation in ("rise", "slide") else "0"
        base = "[0:v]"
        if scrim_path:
            filters.append(f"[1:v]format=rgba,fade=t=in:st=0:d=0.8:alpha=1,fade=t=out:st={fade_out:.2f}:d=0.7:alpha=1[sc]")
            filters.append("[0:v][sc]overlay=0:0[v0]")
            base = "[v0]"
        # Non-top anchors get a soft box instead of the scrim for legibility.
        box = "" if scrim_path else ":box=1:boxcolor=black@0.35:boxborderw=12"
        prev = base
        for i, line in enumerate(lines):
            out = f"[vt{i + 1}]"
            y = f"{top + i * line_height:.1f}-24*if(lt(t,0.8),{entrance},0)" if animation == "rise" else f"{top + i * line_height:.1f}"
            x = f"(w-text_w)/2-40*if(lt(t,0.8),{entrance},0)" if animation == "slide" else "(w-text_w)/2"
            filters.append(
                f"{prev}drawtext=fontfile={FONT}:text='{drawtext_escape(line)}':fontsize={size}:"
                f"fontcolor={color}:shadowcolor={shadow}:shadowx=0:shadowy=2{box}:"
                f"x='{x}':y='{y}':alpha='{alpha}'{out}"
            )
            prev = out
        v_out = prev
    # LTX's own audio (ambience plus native dialogue) passes through untouched.
    cmd += ["-filter_complex", ";".join(filters), "-map", v_out, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-c:a", "copy", "-movflags", "+faststart", "-t", f"{duration:.2f}", out_path]
    print(f"[timing] finish start (filters={len(filters)})", flush=True)
    subprocess.run(cmd, check=True, capture_output=True, timeout=300)
    print("[timing] finish done", flush=True)
    if scrim_path and os.path.exists(scrim_path):
        os.remove(scrim_path)


def cover_fit(raw: bytes, width: int, height: int) -> str:
    """Cover-crop the seller's scene photo to the exact generation size."""
    from PIL import Image as PILImage

    im = PILImage.open(io.BytesIO(raw)).convert("RGB")
    scale = max(width / im.width, height / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), PILImage.LANCZOS)
    left, top = (im.width - width) // 2, (im.height - height) // 2
    p = "/tmp/first-frame.png"
    im.crop((left, top, left + width, top + height)).save(p)
    return p


@app.cls(
    image=image,
    gpu=GPU,
    volumes={WEIGHTS_DIR: volume},
    cpu=16.0,
    # 25 min: headroom for a double cold start (B300 snapshot rebuild plus
    # first A10G image pull); warm runs finish in ~5.
    timeout=1500,
    # Cost-first scaling: nothing warm when idle, one GPU job at a time, and
    # the container exits 5 s after each job. Every animation pays a cold
    # start (~1 min to restore and warm up) instead of idle GPU time.
    min_containers=0,
    max_containers=1,
    scaledown_window=5,
    enable_memory_snapshot=True,
)
class Animator:
    @modal.enter(snap=True)
    def setup(self):
        # Builds no weights and touches no CUDA: safe in the snapshot phase.
        from pathlib import Path

        root = Path(WEIGHTS_DIR) / REPO
        path = {k: str(root / v) for k, v in FILES.items()}
        self.pipe = DistilledPipeline(
            model_paths=ModelPaths.from_split(
                transformer_path=path["transformer"],
                text_encoder_path=path["text_encoder"],
                video_vae_path=path["video_vae"],
                audio_vae_path=path["audio_vae"],
            ),
            spatial_upsampler_path=path["spatial_upsampler"],
            loras=(),
            device=torch.device("cuda"),
            registry=ModelRegistry(cache_weights=True, cache_models=True),
        )
        # Let NATTEN pick its Blackwell kernel instead of the default's
        # sm80-era cutlass-fna (lowest VRAM, ~2x slower decode on B200).
        vd = self.pipe.video_decoder
        prepared = vd._prepared_builder
        natten_auto = ModuleOps("natten_auto_backend", lambda m: True, lambda m: (configure_natten_backend(m, None), m)[1])
        vd._prepared_builder = lambda: (b := prepared()).with_module_ops((*b.module_ops, natten_auto))

    @modal.enter()
    def warm_up(self):
        # Pulls every weight from the Volume onto the GPU and initializes the
        # kernels, so the first real job doesn't pay for it mid-request.
        Image.new("RGB", (768, 960), (90, 120, 160)).save("/tmp/warmup.png")
        self._generate("A calm lake at sunrise, mist over the water.", 0, 768, 960, 25, ["/tmp/warmup.png"], "/tmp/warmup.mp4")

    def _generate(self, prompt, seed, width, height, frames, images, out_path):
        with torch.inference_mode():
            result = self.pipe(
                prompt=prompt,
                seed=seed,
                height=height,
                width=width,
                frame_rate=float(FPS),
                num_frames=frames,
                images=[ImageConditioningInput(path=p, frame_idx=0, strength=1.0) for p in images],
            )
            video = next(result.video)
            silent = out_path.removesuffix(".mp4") + ".video.mp4"
            encode_video(video=video, fps=FPS, audio=None, output_path=silent, video_chunks_number=1)
            audio = result.audio
            if audio is None:
                os.replace(silent, out_path)
            else:
                mux_audio(silent, out_path, audio.waveform, audio.sampling_rate)
                os.remove(silent)
        return video.shape[0], audio is not None

    @modal.method()
    def generate(self, job: dict) -> dict:
        import base64

        width, height = SIZES.get(job.get("aspect"), SIZES["4:5"])
        duration_sec = int(job.get("duration_sec", 5))
        frames = FRAMES.get(duration_sec, FRAMES[5])
        camera = CAMERA_HINTS.get(job.get("camera"), CAMERA_HINTS["slow_push_in"])
        prompt = " ".join(x for x in (job.get("prompt", "").strip(), camera, TAKE_LINE, audio_line(job), NO_TEXT_LINE) if x)
        try:
            raw = base64.b64decode(job["image_b64"])
        except Exception:
            raise ValueError("image_b64 is not valid base64")
        try:
            first = cover_fit(raw, width, height)
        except Exception:
            raise ValueError("The scene photo could not be read. Try a JPEG or PNG.")
        headline = str(job.get("headline", "") or "")[:120]
        out = "/tmp/animated.mp4"
        mixed = "/tmp/animated.mixed.mp4"
        n_frames, has_audio = self._generate(prompt, int(job.get("seed", 1)), width, height, frames, [first], mixed)
        duration = n_frames / FPS
        finish(mixed, out, headline, duration, width, height, job.get("title_style"))
        with open(out, "rb") as f:
            video = f.read()
        for p in (out, mixed, first):
            if os.path.exists(p):
                os.remove(p)
        return {"video": video, "frames": n_frames, "fps": FPS, "width": width, "height": height,
                "audio": has_audio, "headline": bool(headline)}


def _web_app():
    import fastapi
    from fastapi import Depends, HTTPException, Request
    from fastapi.responses import JSONResponse, Response

    web = fastapi.FastAPI(title=APP_NAME)

    def check_key(request: Request):
        want = os.environ.get("ANIMATE_KEY", "")
        got = request.headers.get("authorization", "")
        if not want or got != f"Bearer {want}":
            raise HTTPException(status_code=401, detail="bad or missing API key")

    @web.post("/start")
    def start(job: dict, _=Depends(check_key)):
        if not job.get("image_b64") or not job.get("prompt"):
            return JSONResponse({"error": "image_b64 and prompt are required"}, status_code=400)
        call = Animator().generate.spawn(job)
        return {"call_id": call.object_id}

    @web.get("/status/{call_id}")
    def status(call_id: str, _=Depends(check_key)):
        try:
            out = modal.FunctionCall.from_id(call_id).get(timeout=0)
        except TimeoutError:
            return {"status": "running"}
        except Exception as e:
            return {"status": "error", "message": f"{type(e).__module__}.{type(e).__name__}: {e}"[:500]}
        return {"status": "done", "frames": out["frames"], "fps": out["fps"],
                "width": out["width"], "height": out["height"], "audio": out["audio"], "bytes": len(out["video"]),
                "headline": out.get("headline", False)}

    @web.get("/result/{call_id}")
    def result(call_id: str, _=Depends(check_key)):
        try:
            out = modal.FunctionCall.from_id(call_id).get(timeout=60)
        except TimeoutError:
            return JSONResponse({"error": "still running"}, status_code=425)
        except Exception as e:
            return JSONResponse({"error": f"{type(e).__name__}: {e}"[:500]}, status_code=500)
        return Response(content=out["video"], media_type="video/mp4",
                        headers={"Content-Disposition": 'attachment; filename="animated-scene.mp4"'})

    return web


@app.function(image=web_image, secrets=[KEY_SECRET], timeout=120)
@modal.asgi_app()
def web():
    return _web_app()
