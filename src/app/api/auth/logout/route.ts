import { handle } from '@/lib/server/http';
import { endSession } from '@/lib/server/auth';

export async function POST(req: Request) {
  return handle(async () => {
    const response = Response.json({ ok: true });
    response.headers.append('Set-Cookie', await endSession(req));
    return response;
  });
}
