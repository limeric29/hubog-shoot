import { handle, rateLimit, imageUrl, text } from '@/lib/server/http';
import { MetaError, sparkJson } from '@/lib/server/meta';
import { CHECK_SYSTEM, VERDICT_SCHEMA, checkText } from '@/lib/server/prompts';
import { verifyShootSession } from '@/lib/server/turnstile';
import type { Product, Verdict } from '@/lib/types';

export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'check', 70);
    await verifyShootSession(req);
    const body = await req.json();
    const photo = imageUrl(body.photo, 'photo');
    const image = imageUrl(body.image, 'image');
    const product = {
      name: text(body.product?.name, 'product.name', 200),
      label_text: text(body.product?.label_text, 'product.label_text', 300),
    } as Product;
    // Existing clients send the full brief in `language`. Match /api/plan's limit;
    // checkText already keeps only a short excerpt for the model's language hint.
    const sellerWords = text(body.language, 'language', 2000);
    const verdict = await sparkJson<Verdict>({
      system: CHECK_SYSTEM,
      text: checkText(product, sellerWords),
      images: [photo, image],
      name: 'verdict',
      schema: VERDICT_SCHEMA,
      // No cap here: reasoning Spark endpoints burn most of the budget thinking
      // before they answer, and a small cap truncates the verdict to nothing.
    });
    // The reshoot request validates each problem, so clamp them here instead of
    // failing the retry on an overlong model string.
    if (!verdict || typeof verdict !== 'object') {
      throw new MetaError(502, 'The photo check came back empty. Please try again.');
    }
    return {
      pass: verdict.pass === true,
      problems: Array.isArray(verdict.problems)
        ? verdict.problems.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 300)).slice(0, 6)
        : [],
      seller_note: typeof verdict.seller_note === 'string' ? verdict.seller_note : '',
    };
  });
}
