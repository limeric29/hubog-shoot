import { handle, rateLimit, imageUrl, int, text } from '@/lib/server/http';
import { MetaError, segment } from '@/lib/server/meta';

export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'segment', 90);
    const body = await req.json();
    const image = imageUrl(body.image, 'image');
    const width = int(body.width, 'width', 16, 4096);
    const height = int(body.height, 'height', 16, 4096);
    if (Array.isArray(body.points) && body.points.length) {
      if (body.points.length > 12) throw new MetaError(400, 'Use at most 12 taps.');
      const points = body.points.map((p: { x: unknown; y: unknown; negative?: unknown }, i: number) => ({
        x: int(p.x, `points[${i}].x`, 0, width - 1),
        y: int(p.y, `points[${i}].y`, 0, height - 1),
        negative: p.negative === true,
      }));
      return segment({ image, width, height, points });
    }
    return segment({ image, width, height, phrase: text(body.phrase, 'phrase', 120) || 'product' });
  });
}
