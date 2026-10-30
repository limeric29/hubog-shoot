// Render the real studio components in three sample states in an isolated build.
// Production source and routes are unchanged; the exported pages make no API calls.
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputArg = process.argv.indexOf('--output-dir');
const outputDir = path.resolve(outputArg === -1 ? path.dirname(root) : process.argv[outputArg + 1]);
const buildDir = await mkdtemp(path.join(tmpdir(), 'hubog-shoot-layout-'));
const pages = [
  { route: 'index', file: 'hubog-shoot-layout-preview.html', title: 'Your product' },
  { route: 'preview/shoot', file: 'hubog-shoot-step-2-preview.html', title: 'Your shoot' },
  { route: 'preview/pack', file: 'hubog-shoot-step-3-preview.html', title: 'Your pack' },
];

function replaceOnce(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) {
    throw new Error(`Studio changed; update the preview initializer for: ${before}`);
  }
  return text.replace(before, after);
}

async function build() {
  for (const dir of ['src', 'public']) await cp(path.join(root, dir), path.join(buildDir, dir), { recursive: true });
  for (const file of ['package.json', 'tsconfig.json', 'next.config.ts']) await copyFile(path.join(root, file), path.join(buildDir, file));
  await symlink(path.join(root, 'node_modules'), path.join(buildDir, 'node_modules'), 'dir');
  await copyFile(path.join(root, 'docs/previews/studio-fixture.json'), path.join(buildDir, 'src/lib/layout-fixture.json'));
  await writeFile(path.join(buildDir, 'src/lib/layout-fixture.ts'), `
import type { Photo } from './client/image';
import type { Plan } from './types';
import type { ShotState } from '@/components/shot-card';
import fixture from './layout-fixture.json';

export interface StudioSnapshot {
  photo: Photo;
  brief: string;
  plan: Plan;
  shots: Record<string, ShotState>;
}

export function snapshot(phase: 'shoot' | 'pack'): StudioSnapshot {
  const shots = fixture.shots.map(({ image: _image, ...shot }) => shot) as Plan['shots'];
  const plan: Plan = {
    product: fixture.product,
    listing: fixture.listing,
    shots,
    question: phase === 'shoot' ? fixture.question : '',
  };
  const photo = { url: '/examples/source.jpg', hires: '/examples/source.jpg', width: 900, height: 900, scale: 1 };
  const states: Record<string, ShotState> = {};
  fixture.shots.forEach((shot, i) => {
    const done = phase === 'pack' || i < 2;
    states[shot.id] = done ? {
      status: 'done', image: shot.image, real: shot.kind === 'main',
      verdict: { pass: true, problems: [], seller_note: shot.kind === 'main'
        ? 'Your original product, cut out onto a clean white background.'
        : 'Shape, color, and label checked against your original photo.' },
    } : { status: i === 2 ? 'checking' : i === 3 ? 'shooting' : 'queued' };
  });
  return { photo, brief: fixture.brief, plan, shots: states };
}
`);

  const studioPath = path.join(buildDir, 'src/components/studio.tsx');
  let studio = await readFile(studioPath, 'utf8');
  studio = replaceOnce(studio, "import styles from './studio.module.css';", "import styles from './studio.module.css';\nimport type { StudioSnapshot } from '@/lib/layout-fixture';");
  studio = replaceOnce(studio, 'export function Studio() {', 'export function Studio({ initial }: { initial?: StudioSnapshot }) {');
  studio = replaceOnce(studio, 'useState<Photo | null>(null)', 'useState<Photo | null>(initial?.photo ?? null)');
  studio = replaceOnce(studio, "const [brief, setBrief] = useState('');", "const [brief, setBrief] = useState(initial?.brief ?? '');");
  studio = replaceOnce(studio, "useState<Stage>('brief')", "useState<Stage>(initial ? 'results' : 'brief')");
  studio = replaceOnce(studio, 'useState<Plan | null>(null)', 'useState<Plan | null>(initial?.plan ?? null)');
  studio = replaceOnce(studio, 'useState<Record<string, ShotState>>({})', 'useState<Record<string, ShotState>>(initial?.shots ?? {})');
  await writeFile(studioPath, studio);

  for (const phase of ['shoot', 'pack']) {
    const dir = path.join(buildDir, 'src/app/preview', phase);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'page.tsx'), `import { Studio } from '@/components/studio';\nimport { snapshot } from '@/lib/layout-fixture';\nexport default function Preview() { return <Studio initial={snapshot('${phase}')} />; }\n`);
  }

  // The sandbox blocks Turbopack's internal listener. Compile the same Tailwind
  // input ahead of a webpack build, only inside this temporary project.
  const cssPath = path.join(buildDir, 'src/app/globals.css');
  const compiled = await compile(await readFile(cssPath, 'utf8'), { base: path.dirname(cssPath), onDependency() {} });
  const scanner = new Scanner({ sources: [{ base: buildDir, pattern: 'src/**/*.{ts,tsx}', negated: false }] });
  await writeFile(cssPath, compiled.build(scanner.scan()));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
      cwd: buildDir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Preview build exited ${code}`)));
  });
}

const mime = (file) => file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
const dataCache = new Map();
async function dataUrl(file) {
  if (!dataCache.has(file)) dataCache.set(file, `data:${mime(file)};base64,${(await readFile(file)).toString('base64')}`);
  return dataCache.get(file);
}

async function exportPage(page, index) {
  let html = await readFile(path.join(buildDir, '.next/server/app', `${page.route}.html`), 'utf8');
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(([tag]) => /href="([^"]+)"/.exec(tag)?.[1]);
  let css = '';
  for (const href of stylesheets) {
    if (!href?.startsWith('/_next/')) throw new Error('Unexpected stylesheet path in preview.');
    let sheet = await readFile(path.join(buildDir, '.next', href.slice('/_next/'.length)), 'utf8');
    for (const [match, url] of sheet.matchAll(/url\(([^)]+)\)/g)) {
      const asset = url.replace(/^['"]|['"]$/g, '');
      if (asset.startsWith('/_next/')) sheet = sheet.replace(match, `url(${await dataUrl(path.join(buildDir, '.next', asset.slice('/_next/'.length)))})`);
    }
    css += sheet;
  }
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  html = html.replace('</head>', `<style>${css}</style></head>`);
  html = html.replace('<title>Hubog Shoot</title>', `<title>Hubog Shoot — ${page.title} preview</title>`);
  for (const [, attr, url] of [...html.matchAll(/(src|href)="(\/(?:examples|brand)\/[^"<>]+)"/g)]) {
    html = html.replace(`${attr}="${url}"`, `${attr}="${await dataUrl(path.join(buildDir, 'public', url.slice(1)))}"`);
  }

  html = html.replace(/(<ol\b[^>]*aria-label="Your progress"[^>]*>)([\s\S]*?)(<\/ol>)/, (_all, start, contents, end) => {
    let step = 0;
    const linked = contents.replace(/<li([^>]*)>([\s\S]*?)<\/li>/g, (_li, attrs, body) => {
      const target = pages[step++];
      return `<li${attrs} style="position:relative"><a href="${target.file}" aria-label="Preview ${target.title.toLowerCase()}" title="Preview ${target.title.toLowerCase()}" style="position:absolute;inset:-8px;border-radius:8px"></a>${body}</li>`;
    });
    if (step !== 3) throw new Error('Expected three preview navigation steps.');
    return start + linked + end;
  });
  html = html.replace(/(<body[^>]*>)/, '$1<aside aria-label="Preview notice" style="padding:8px 16px;background:#e6f1ff;color:#0b4fb8;text-align:center;font-size:12px;line-height:1.6">Design preview with sample photos and listing text. Use the header steps to switch screens.</aside>');
  const articleCount = (html.match(/<article\b/g) ?? []).length;
  const doneCount = (html.match(/>Product checked<\/p>/g) ?? []).length;
  if (index > 0 && (articleCount !== 5 || doneCount !== (index === 1 ? 2 : 5))) {
    throw new Error(`Incorrect sample state in ${page.title}: ${articleCount} photos, ${doneCount} ready.`);
  }
  if (/<script\b/.test(html) || /(?:src|href)="\/(?:examples|brand|_next)\//.test(html)) throw new Error('Preview has an unresolved runtime dependency.');
  await writeFile(path.join(outputDir, page.file), html);
  console.log(`${page.title}: ${path.join(outputDir, page.file)}`);
}

await build();
await mkdir(outputDir, { recursive: true });
for (const [index, page] of pages.entries()) await exportPage(page, index);
await rm(buildDir, { recursive: true, force: true });
