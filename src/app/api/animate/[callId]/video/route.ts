import { handle } from '@/lib/server/http';
import { animateVideo } from '@/lib/server/animate';

export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  return handle(async () => animateVideo((await params).callId));
}
