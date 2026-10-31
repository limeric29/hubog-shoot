import { handle, rateLimit, imageUrl, text } from '@/lib/server/http';
import { animateStart } from '@/lib/server/animate';
import { animatePrompt } from '@/lib/server/prompts';
import { verifyShootSession, verifyTurnstile } from '@/lib/server/turnstile';
import type { Aspect } from '@/lib/types';

const ASPECTS: Aspect[] = ['1:1', '4:5', '9:16'];

// Each animation burns B300 GPU time, so each start costs a fresh Turnstile
// solve on top of the shoot session: automated callers can't stockpile one
// verification into many videos. The daily cap is the backstop.
export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'animate', 5, "You have used today's free animations on this demo. Please come back tomorrow.");
    await verifyShootSession(req);
    const body = await req.json();
    const image = imageUrl(body.image, 'image');
    const aspect = body.shot?.aspect as Aspect;
    if (!ASPECTS.includes(aspect)) throw new Error('aspect is not supported.');
    const sessionCookie = await verifyTurnstile(req, body.turnstileToken, 'animate');
    const prompt = animatePrompt(
      { name: text(body.product?.name, 'product.name', 200), label: text(body.product?.label_text, 'product.label_text', 300) },
      { scene: text(body.shot?.scene, 'shot.scene', 1200), backdrop: text(body.shot?.backdrop, 'shot.backdrop', 1200) },
    );
    const call_id = await animateStart(image.replace(/^data:image\/\w+;base64,/, ''), prompt, aspect);
    const response = Response.json({ call_id });
    if (sessionCookie) response.headers.append('Set-Cookie', sessionCookie);
    return response;
  });
}
