// Prompts and JSON schemas for Muse Spark and Muse Image.
import type { Product, Shot } from '../types';

const str = { type: 'string' } as const;
const strs = { type: 'array', items: str } as const;

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question', 'product', 'shots', 'listing'],
  properties: {
    question: str,
    product: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'category', 'colors', 'label_text', 'sam_phrase'],
      properties: { name: str, category: str, colors: strs, label_text: str, sam_phrase: str },
    },
    shots: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'title', 'platform', 'aspect', 'scene', 'headline', 'caption'],
        properties: {
          id: str,
          kind: { type: 'string', enum: ['main', 'lifestyle', 'detail', 'promo'] },
          title: str,
          platform: { type: 'string', enum: ['shopee', 'lazada', 'tiktok', 'facebook'] },
          aspect: { type: 'string', enum: ['1:1', '4:5', '9:16'] },
          scene: str,
          headline: str,
          caption: str,
        },
      },
    },
    listing: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'hashtags'],
      properties: { title: str, description: str, hashtags: strs },
    },
  },
} as const;

export const PLAN_SYSTEM = `You are the photo director for Hubog Shoot, a tool that gives small online sellers in the Philippines a product photo shoot they cannot afford to hire. The seller sends one phone photo and a short description. You look at the photo and plan the shoot.

Language: write everything the seller will read (question, titles, headlines, captions, the listing) in the language the seller wrote in. English stays English, Filipino stays Filipino, and Taglish stays Taglish. If the seller wrote nothing useful, use natural Taglish. Write each "scene" in English, because the image model reads English best.

Product: describe what is really in the photo. Copy any printed text on the product or label exactly as it reads, and leave label_text empty if there is none. Never invent text, claims, prices, certifications or ingredients. sam_phrase is a short noun phrase naming the product for a segmentation model, such as "glass bottle of juice" or "red handbag". It is not a command or a question.

Question: ask at most one follow-up, in the seller's language, and only if something important for selling is missing, such as the price, the size or the main selling point. Leave it empty when the brief is enough. Plan the shoot either way.

Shots: exactly five, in this order.
1. kind "main", platform "shopee", aspect "1:1", id "main". The marketplace main image: the product alone on a plain white background. The app builds it from the seller's real photo, so scene is a one-line note.
2. kind "lifestyle", platform "facebook", aspect "4:5", id "lifestyle-1". The product in a believable setting that matches how a buyer would use it.
3. kind "lifestyle", platform "shopee", aspect "4:5", id "lifestyle-2". A different setting and different light from shot 2.
4. kind "detail", platform "lazada", aspect "1:1", id "detail". A close, flattering view of the product's best feature.
5. kind "promo", platform "tiktok", aspect "9:16", id "promo". A bold vertical creative with clear empty space at the top for a headline.

For every shot: "scene" describes the surroundings, props, surface and light, and says nothing that would change the product itself. "headline" is a punchy line of at most four words that the app draws on top of the image, or empty if the shot should stay clean (the main image and the detail shot stay clean). "caption" is one short line to post with the image. "title" names the shot for the seller.

Listing: a marketplace title under 90 characters that says what the product is, a description of two to four short sentences using only facts from the photo and the brief, and five to eight hashtags without the # sign.`;

export function planText(brief: string, answer?: string) {
  const parts = [brief.trim() ? `Seller's description: ${brief.trim()}` : "The seller didn't write a description. Work from the photo."];
  if (answer?.trim()) parts.push(`Answer to your follow-up question: ${answer.trim()}`);
  return parts.join('\n');
}

export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'problems', 'seller_note'],
  properties: { pass: { type: 'boolean' }, problems: strs, seller_note: str },
} as const;

export const CHECK_SYSTEM = `You check generated product photos for an online seller. You get two images: first the seller's REAL product photo, then a GENERATED shot meant to show the same product. A listing must never show a product the seller does not have, so be strict about the product itself and relaxed about the surroundings.

Fail the shot if any of these is true:
- The product's shape, proportions, colour or material differs from the real photo.
- Printed text, a logo or a label on the product is missing, changed, misspelled or unreadable when the real photo's is readable.
- Parts were added or removed, such as a different cap, handle, strap or extra product.
- Text overlaid anywhere in the image is garbled or misspelled.

Pass the shot when the product matches, even if the background, props, light and angle differ from the real photo, as the seller asked for a new scene.

"problems": short English phrases naming each difference, for the retry prompt. Empty when the shot passes.
"seller_note": one short sentence for the seller, in the language of the seller's description given below, saying what you found.`;

export function checkText(product: Product, sellerWords: string) {
  const words = sellerWords.trim().slice(0, 200) || 'Taglish';
  return `Product: ${product.name}.${product.label_text ? ` Printed text on it: "${product.label_text}".` : ''}\nThe seller's own words, which set the language of seller_note: "${words}"`;
}

const FIDELITY = `The first image is the seller's real product. Show exactly this product in the new scene: the same shape, proportions, colours, materials and printed text or logo, with every letter on the label unchanged. Do not redesign it, add parts, or change its label. Photorealistic, natural, like a good phone-camera product shot. No watermark, no borders, and no added text or captions anywhere in the image.`;

export function shootPrompt(product: Product, shot: Shot, problems: string[] = []) {
  const fix = problems.length
    ? `\nThe last attempt was rejected because: ${problems.join('; ')}. Fix exactly that, and copy the product from the real photo more closely.`
    : '';
  const space = shot.headline ? ' Keep a clean, uncluttered area at the top of the frame for a headline.' : '';
  // Tall shots are cropped to 4:5 or 9:16 afterwards, so the product must sit well inside the frame.
  const crop = shot.aspect === '1:1' ? '' : ' Keep the whole product centred with generous margin on every side, because the frame is cropped slightly afterwards.';
  return `${FIDELITY}\nProduct: ${product.name}.\nScene: ${shot.scene}.${space}${crop}${fix}`;
}
