import { handle, rateLimit, text } from '@/lib/server/http';
import { clientIp, quotaFor, register, startSession } from '@/lib/server/auth';
import { verifyTurnstile } from '@/lib/server/turnstile';

export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(req, 'register', 10, 'Too many signups from this network. Please try again tomorrow.');
    const body = await req.json();
    await verifyTurnstile(req, body.turnstileToken, 'register');
    const user = await register(text(body.email, 'email', 320), text(body.password, 'password', 128), clientIp(req));
    const session = await startSession(user.id);
    const response = Response.json({ email: user.email, quota: await quotaFor(user, clientIp(req)) });
    response.headers.append('Set-Cookie', session.cookie);
    return response;
  });
}
