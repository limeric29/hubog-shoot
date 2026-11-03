import { handle, rateLimit, imageUrl, text } from '@/lib/server/http';
import { animateStart } from '@/lib/server/animate';
import { ANIMATE_DIRECTOR_SYSTEM, ANIMATE_MOTION_SCHEMA, DEFAULT_VOICE, animateDirectorText, animatePrompt } from '@/lib/server/prompts';
import { sparkJson, sparkOpenConfigured } from '@/lib/server/meta';
import { verifyShootSession, verifyTurnstile } from '@/lib/server/turnstile';
import { clientIp, consumeAnim, consumeGlobalAnims, getAuthUser, isStaff } from '@/lib/server/auth';
import type { Aspect } from '@/lib/types';

const ASPECTS: Aspect[] = ['1:1', '4:5', '9:16'];

interface TitleStyle {
  anchor: 'top' | 'center' | 'bottom';
  animation: 'fade' | 'rise' | 'slide';
  color: 'white' | 'black';
}

/** Clamp the director's title styling to the animations Modal implements. */
function readTitleStyle(value: unknown): TitleStyle | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const pick = <T extends string>(x: unknown, options: readonly T[], fallback: T): T =>
    options.includes(x as T) ? (x as T) : fallback;
  if (v.anchor === undefined && v.animation === undefined && v.color === undefined) return null;
  return {
    anchor: pick(v.anchor, ['top', 'center', 'bottom'] as const, 'top'),
    animation: pick(v.animation, ['fade', 'rise', 'slide'] as const, 'fade'),
    color: pick(v.color, ['white', 'black'] as const, 'white'),
  };
}

// Each animation burns B300 GPU time, so each start costs a fresh Turnstile
// solve on top of the shoot session: automated callers can't stockpile one
// verification into many videos. The daily cap is the backstop.
export async function POST(req: Request) {
  return handle(async () => {
    const me = await getAuthUser(req);
    if (!me || !isStaff(me.email)) rateLimit(req, 'animate', 5, "You have used today's free animations on this demo. Please come back tomorrow.");
    await verifyShootSession(req);
    const body = await req.json();
    // The raw scene when the client has it: baked headlines would freeze over
    // moving video and diffusion garbles text, so the headline is composited
    // animated in post instead.
    const image = body.raw ? imageUrl(body.raw, 'raw') : imageUrl(body.image, 'image');
    const headline = text(body.headline, 'headline', 120);
    const aspect = body.shot?.aspect as Aspect;
    if (!ASPECTS.includes(aspect)) throw new Error('aspect is not supported.');
    const sessionCookie = await verifyTurnstile(req, body.turnstileToken, 'animate');
    await consumeAnim(me, clientIp(req));
    await consumeGlobalAnims();
    const product = { name: text(body.product?.name, 'product.name', 200), label: text(body.product?.label_text, 'product.label_text', 300) };
    const shot = { scene: text(body.shot?.scene, 'shot.scene', 1200), backdrop: text(body.shot?.backdrop, 'shot.backdrop', 1200) };
    // Spark directs the motion from the actual frame: open weights first,
    // then 1.3 when the open call has issues, then the template, so a
    // direction failure never blocks the animation.
    let motion: string | null = null;
    let camera = 'slow_push_in';
    let voiceDesc: string | null = null;
    let titleStyle: TitleStyle | null = null;
    for (const open of sparkOpenConfigured() ? [true, false] : [false]) {
      try {
        const dir = await sparkJson<{ motion?: unknown; camera?: unknown; voice?: unknown; title?: unknown }>({
          system: ANIMATE_DIRECTOR_SYSTEM,
          text: animateDirectorText(product, shot),
          images: [image],
          name: 'animate_motion',
          schema: ANIMATE_MOTION_SCHEMA,
          open,
        });
        if (typeof dir?.motion === 'string' && dir.motion.trim()) motion = dir.motion.trim().slice(0, 600);
        if (dir?.camera === 'static' || dir?.camera === 'drift' || dir?.camera === 'slow_push_in') camera = dir.camera;
        if (typeof dir?.voice === 'string' && dir.voice.trim()) voiceDesc = dir.voice.trim().slice(0, 200);
        titleStyle = readTitleStyle(dir?.title);
        break;
      } catch (err) {
        console.error(`[animate] direction via ${open ? 'open weights' : '1.3'} failed:`, err instanceof Error ? err.message : err);
      }
    }
    const prompt = motion ?? animatePrompt(product, shot);
    const call_id = await animateStart(image.replace(/^data:image\/\w+;base64,/, ''), prompt, aspect, camera, {
      ...(headline ? { headline } : {}),
      // The designed voice always ships with a headline: VoxCPM2 speaks it on the GPU.
      ...(headline ? { voice_desc: voiceDesc ?? DEFAULT_VOICE } : {}),
      ...(headline && titleStyle ? { title_style: titleStyle } : {}),
    });
    const response = Response.json({ call_id });
    if (sessionCookie) response.headers.append('Set-Cookie', sessionCookie);
    return response;
  });
}
