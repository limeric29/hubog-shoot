import { handle, rateLimit, imageUrl, text } from '@/lib/server/http';
import { MetaError, sparkJson } from '@/lib/server/meta';
import { PLAN_SCHEMA, PLAN_SYSTEM, planText } from '@/lib/server/prompts';
import { verifyTurnstile } from '@/lib/server/turnstile';
import type { Aspect, Plan, Shot } from '@/lib/types';

const ASPECTS: Aspect[] = ['1:1', '4:5', '9:16'];

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
    // Unenforced schemas can return missing or overlong strings. The shoot and
    // segment requests validate lengths, so clamp every field they check: a loose
    // plan then still shoots instead of failing downstream.
    if (!plan || !Array.isArray(plan.shots) || plan.shots.length === 0) {
      throw new MetaError(502, 'The shot plan came back empty. Please try again.');
    }
    const clamp = (value: unknown, max: number): string =>
      typeof value === 'string' ? value.slice(0, max) : '';
    const product = plan.product ?? ({} as Plan['product']);
    plan.product = {
      name: clamp(product.name, 200) || 'Product',
      category: clamp(product.category, 200),
      colors: Array.isArray(product.colors) ? product.colors.filter((c): c is string => typeof c === 'string') : [],
      label_text: clamp(product.label_text, 300),
      sam_phrase: clamp(product.sam_phrase, 120) || clamp(product.name, 120) || 'product',
    };
    plan.shots = plan.shots.slice(0, 8).map((shot, i) => {
      const maybe = (typeof shot === 'object' && shot !== null ? shot : {}) as Partial<Shot>;
      return {
        ...(typeof shot === 'object' && shot !== null ? shot : {}),
        id: clamp(maybe.id, 60) || `shot-${i + 1}`,
        aspect: ASPECTS.includes(maybe.aspect as Aspect) ? (maybe.aspect as Aspect) : '1:1',
        scene: clamp(maybe.scene, 1200),
        backdrop: clamp(maybe.backdrop, 1200),
        headline: clamp(maybe.headline, 80),
      } as Shot;
    });
    const response = Response.json(plan);
    if (sessionCookie) response.headers.append('Set-Cookie', sessionCookie);
    return response;
  });
}
