import { handle, rateLimit, imageUrl, text } from '@/lib/server/http';
import { sparkJson } from '@/lib/server/meta';
import { CHECK_SYSTEM, VERDICT_SCHEMA, checkText } from '@/lib/server/prompts';
import type { Product, Verdict } from '@/lib/types';

export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'check', 70);
    const body = await req.json();
    const photo = imageUrl(body.photo, 'photo');
    const image = imageUrl(body.image, 'image');
    const product = {
      name: text(body.product?.name, 'product.name', 200),
      label_text: text(body.product?.label_text, 'product.label_text', 300),
    } as Product;
    const language = text(body.language, 'language', 200);
    return sparkJson<Verdict>({
      system: CHECK_SYSTEM,
      text: checkText(product, language),
      images: [photo, image],
      name: 'verdict',
      schema: VERDICT_SCHEMA,
      maxTokens: 3000,
    });
  });
}
