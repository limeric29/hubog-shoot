import { handle } from '@/lib/server/http';
import { MetaError, transcribeWav } from '@/lib/server/meta';

// 16 kHz mono 16-bit WAV is 32 KB a second, so 2 MB covers about a minute.
const MAX_BYTES = 2_000_000;

export async function POST(req: Request) {
  return handle(async () => {
    const wav = await req.arrayBuffer();
    if (wav.byteLength < 1000 || wav.byteLength > MAX_BYTES) throw new MetaError(400, 'The recording must be a WAV under about a minute.');
    return { transcript: await transcribeWav(wav) };
  });
}
