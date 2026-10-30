// Records the microphone and returns a 16 kHz mono 16-bit WAV, the only format Muse Voice Transcribe takes.
// MediaRecorder produces webm or mp4 depending on the browser, so the recording is decoded and re-encoded.

const RATE = 16000;

function encodeWav(pcm: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

async function toWav(recording: ArrayBuffer): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(recording);
  await ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return encodeWav((await off.startRendering()).getChannelData(0));
}

export class Recorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }

  stop(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const rec = this.rec;
      if (!rec) return reject(new Error('Not recording.'));
      rec.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        try {
          resolve(await toWav(await new Blob(this.chunks, { type: rec.mimeType }).arrayBuffer()));
        } catch {
          reject(new Error('That recording could not be read.'));
        }
      };
      rec.stop();
    });
  }
}
