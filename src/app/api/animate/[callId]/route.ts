import { handle } from '@/lib/server/http';
import { animateStatus } from '@/lib/server/animate';

export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  return handle(async () => animateStatus((await params).callId));
}
