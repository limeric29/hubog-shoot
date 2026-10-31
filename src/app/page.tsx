import { Studio } from '@/components/studio';
import { connection } from 'next/server';
import { turnstileEnabled } from '@/lib/server/turnstile';

export default async function Home() {
  await connection();
  const enabled = turnstileEnabled();
  return <Studio turnstileEnabled={enabled} turnstileSiteKey={enabled ? process.env.TURNSTILE_SITEKEY ?? '' : ''} />;
}
