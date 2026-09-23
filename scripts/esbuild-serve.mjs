/**
 * esbuild dev server — an alternative to `npm run dev` (Vite) for checking the
 * app against a plain bundle, and for `--host` when testing on a real device.
 *
 *   npm run serve                  http://127.0.0.1:5174, rebuild + live reload
 *   npm run serve -- --port 8080   pick the port
 *   npm run serve -- --host        listen on the LAN, for a phone or tablet
 *   npm run bundle                 one-shot minified bundle into .esbuild/
 *
 * `index.html` stays the single source of truth: it is copied into the output
 * directory with its Vite-style source paths pointed at the bundle.
 */
import esbuild from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.esbuild');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback;
};

const buildOnly = flag('build');
const port = Number(option('port', process.env.PORT ?? 5174));
const host = flag('host') ? '0.0.0.0' : '127.0.0.1';

const LIVE_RELOAD = `    <script>
      new EventSource('/esbuild').addEventListener('change', () => location.reload());
    </script>
`;

/** Rewrites the Vite entry paths in index.html to the bundled output. */
async function writeHtml({ liveReload }) {
  const source = await readFile(path.join(root, 'index.html'), 'utf8');
  const rewrites = [
    ['/src/style.css', '/style.css'],
    ['/src/main.ts', '/main.js'],
  ];

  let html = source;
  for (const [from, to] of rewrites) {
    if (!html.includes(from)) {
      throw new Error(`index.html no longer references ${from}; update scripts/esbuild-serve.mjs`);
    }
    html = html.replaceAll(from, to);
  }
  if (liveReload) html = html.replace('  </body>', `${LIVE_RELOAD}  </body>`);

  await writeFile(path.join(outdir, 'index.html'), html);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeHtml({ liveReload: !buildOnly });

/**
 * `main.ts` locates the AI worker with the Vite-native
 * `new Worker(new URL('./ai/worker.ts', import.meta.url))` pattern, which
 * Vite bundles specially. Plain esbuild does not — it leaves that string
 * literal untouched — so the source is rewritten as it loads to point at the
 * worker's own separately-bundled output instead. Rewriting the source, not
 * the output file, matters: serve mode answers from memory, so an edit to the
 * file on disk would never reach the browser.
 */
const workerCtx = await esbuild.context({
  entryPoints: [path.join(root, 'src/ai/worker.ts')],
  outfile: path.join(outdir, 'ai/worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: buildOnly,
  logLevel: 'info',
});

const pointWorkerAtBundle = {
  name: 'point-worker-at-bundle',
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]main\.ts$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const needle = './ai/worker.ts';
      if (!source.includes(needle)) {
        throw new Error(`main.ts no longer references ${needle}; update scripts/esbuild-serve.mjs`);
      }
      return { contents: source.replaceAll(needle, './ai/worker.js'), loader: 'ts' };
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [path.join(root, 'src/main.ts'), path.join(root, 'src/style.css')],
  outdir,
  entryNames: '[name]',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: buildOnly,
  logLevel: 'info',
  plugins: [pointWorkerAtBundle],
});

if (buildOnly) {
  await workerCtx.rebuild();
  await workerCtx.dispose();
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`Bundled into ${path.relative(root, outdir)}/`);
} else {
  await workerCtx.watch();
  await ctx.watch();
  const served = await ctx.serve({ servedir: outdir, port, host });
  const shown = host === '0.0.0.0' ? (served.hosts ?? []).join(', ') : host;
  console.log(`Othello on http://${shown}:${served.port} — rebuilding on change`);
}
