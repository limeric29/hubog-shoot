// Shapes shared by the API routes and the UI.

export type Aspect = '1:1' | '4:5' | '9:16';
export type Platform = 'shopee' | 'lazada' | 'tiktok' | 'facebook';
export type ShotKind = 'main' | 'lifestyle' | 'detail' | 'promo';

export interface Product {
  name: string;
  category: string;
  colors: string[];
  /** Text printed on the product or its label, exactly as it reads. Empty if none. */
  label_text: string;
  /** Short noun phrase SAM can segment, e.g. "glass bottle of juice". */
  sam_phrase: string;
}

export interface Shot {
  id: string;
  kind: ShotKind;
  title: string;
  platform: Platform;
  aspect: Aspect;
  /** English scene description for the image model. */
  scene: string;
  /** Short headline the app draws on the image, in the seller's language. Empty if none. */
  headline: string;
  /** Caption for this shot, in the seller's language. */
  caption: string;
}

export interface Listing {
  title: string;
  description: string;
  hashtags: string[];
}

export interface Plan {
  /** One follow-up question in the seller's language, or empty when nothing important is missing. */
  question: string;
  product: Product;
  shots: Shot[];
  listing: Listing;
}

export interface Verdict {
  pass: boolean;
  /** What is wrong, in English, for the redo prompt. Empty when the shot passes. */
  problems: string[];
  /** One short sentence for the seller, in their language. */
  seller_note: string;
}

/** A SAM mask cropped to its box. `bits` is the raster packed 8 pixels per byte, MSB first, base64. */
export interface Mask {
  left: number;
  top: number;
  width: number;
  height: number;
  bits: string;
  area: number;
}
