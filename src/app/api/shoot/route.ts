import { handle, imageUrl, text } from '@/lib/server/http';
import { museImage } from '@/lib/server/meta';
import { scenePrompt, shootPrompt } from '@/lib/server/prompts';
import type { Aspect, Product, Shot } from '@/lib/types';

const ASPECTS: Aspect[] = ['1:1', '4:5', '9:16'];

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const empty = body.empty === true;
    const photo = empty ? undefined : imageUrl(body.photo, 'photo');
    const product: Product = {
      name: text(body.product?.name, 'product.name', 200),
      category: text(body.product?.category, 'product.category', 200),
      colors: [],
      label_text: text(body.product?.label_text, 'product.label_text', 300),
      sam_phrase: '',
    };
    const aspect = body.shot?.aspect as Aspect;
    if (!ASPECTS.includes(aspect)) throw new Error('shot.aspect is not supported.');
    const shot = {
      aspect,
      scene: text(body.shot?.scene, 'shot.scene', 1200),
      backdrop: text(body.shot?.backdrop, 'shot.backdrop', 1200),
      headline: text(body.shot?.headline, 'shot.headline', 80),
    } as Shot;
    const problems = Array.isArray(body.problems) ? body.problems.slice(0, 6).map((p: unknown) => text(p, 'problem', 300)) : [];
    const prompt = empty ? scenePrompt(shot) : shootPrompt(product, shot, problems);
    const image = await museImage({ prompt, photo, aspect });
    return { image };
  });
}
