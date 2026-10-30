import { handle, imageUrl, text } from '@/lib/server/http';
import { sparkJson } from '@/lib/server/meta';
import { PLAN_SCHEMA, PLAN_SYSTEM, planText } from '@/lib/server/prompts';
import type { Plan } from '@/lib/types';

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const photo = imageUrl(body.photo, 'photo');
    const brief = text(body.brief, 'brief', 2000);
    const answer = text(body.answer, 'answer', 600);
    return sparkJson<Plan>({
      system: PLAN_SYSTEM,
      text: planText(brief, answer),
      images: [photo],
      name: 'shot_plan',
      schema: PLAN_SCHEMA,
    });
  });
}
