import { handle, rateLimit, imageUrl, text } from '@/lib/server/http';
import { sparkJson } from '@/lib/server/meta';
import { PLAN_SCHEMA, PLAN_SYSTEM, planText } from '@/lib/server/prompts';
import { verifyTurnstile } from '@/lib/server/turnstile';
import type { Plan } from '@/lib/types';

export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'plan', 12);
    const body = await req.json();
    const photo = imageUrl(body.photo, 'photo');
    const brief = text(body.brief, 'brief', 2000);
    const answer = text(body.answer, 'answer', 600);
    const sessionCookie = await verifyTurnstile(req, body.turnstileToken, 'shoot');
    const plan = await sparkJson<Plan>({
      system: PLAN_SYSTEM,
      text: planText(brief, answer),
      images: [photo],
      name: 'shot_plan',
      schema: PLAN_SCHEMA,
    });
    const response = Response.json(plan);
    if (sessionCookie) response.headers.append('Set-Cookie', sessionCookie);
    return response;
  });
}
