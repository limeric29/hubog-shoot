import { handle } from '@/lib/server/http';
import { clientIp, getAuthUser, quotaFor } from '@/lib/server/auth';

export async function GET(req: Request) {
  return handle(async () => {
    const user = await getAuthUser(req);
    const quota = await quotaFor(user, clientIp(req));
    return { email: user?.email ?? null, quota };
  });
}
