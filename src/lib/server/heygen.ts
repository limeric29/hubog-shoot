// Spoken headline for animated scenes via HeyGen Voice Turbo Free
// (model heygen-voice-1-turbo-free, $0 until Nov 30 2026). Best effort by
// design: shared free capacity can 429 or 500, so every failure returns null
// and the animation ships with ambience only.
const API = 'https://api.heygen.com/v3/models/audio/tts';
const MODEL = 'heygen-voice-1-turbo-free';
const MAX_TEXT = 200;
const MAX_WAV_BYTES = 3_000_000;

export interface Voice {
  /** Base64 WAV bytes, ready to forward to the animation backend. */
  b64: string;
  duration: number;
}

async function post(path: string, apiKey: string, body: unknown): Promise<{ audio_url: string; duration: number } | null> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null) as { data?: { audio_url?: unknown; duration?: unknown } } | null;
  const url = json?.data?.audio_url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  const duration = typeof json?.data?.duration === 'number' ? json.data.duration : 0;
  return { audio_url: url, duration };
}

/** Speak `text`, or null when voice is unconfigured or HeyGen says no. */
export async function speak(text: string): Promise<Voice | null> {
  const apiKey = (process.env.HEYGEN_API_KEY ?? '').trim();
  const voiceId = (process.env.HEYGEN_VOICE_ID ?? '').trim();
  const clean = text.trim().slice(0, MAX_TEXT);
  if (!apiKey || !voiceId || !clean) return null;
  try {
    const made = await post('', apiKey, { text: clean, voice_id: voiceId, model: MODEL, language: 'en' });
    if (!made) return null;
    const res = await fetch(made.audio_url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_WAV_BYTES) return null;
    return { b64: Buffer.from(bytes).toString('base64'), duration: made.duration };
  } catch (err) {
    console.error('[heygen] voiceover failed, shipping ambience only:', err instanceof Error ? err.message : err);
    return null;
  }
}
