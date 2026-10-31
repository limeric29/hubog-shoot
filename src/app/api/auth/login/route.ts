import { handle, rateLimit, text } from '@/lib/server/http';
import { clientIp, login, quotaFor, startSession } from '@/lib/server/auth';

export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'login', 20, 'Too many login attempts from this network. Please try again tomorrow.');
    const body = await req.json();
    const user = await login(text(body.email, 'email', 320), text(body.password, 'password', 128));
    const session = await startSession(user.id);
    const response = Response.json({ email: user.email, quota: await quotaFor(user, clientIp(req)) });
    response.headers.append('Set-Cookie', session.cookie);
    return response;
  });
}
