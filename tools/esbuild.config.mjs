// Shared esbuild configuration for the single-file build (tools/build.mjs) and dev server (tools/serve.mjs).
//
// Assets: `import assets from 'virtual:assets'` resolves to a generated module that embeds every file
// under /assets (excluding previews) as a Uint8Array via esbuild's `binary` loader. The runtime turns
// them into Blob URLs, so the game never fetch()es anything and works from file:// with no server.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSET_DIR = join(ROOT, 'assets');
const EMBED_EXT = new Set(['.glb', '.png', '.jpg', '.jpeg', '.bin', '.ktx2']);

function listAssets(dir = ASSET_DIR, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'previews' || name.startsWith('.')) continue;
      listAssets(p, out);
    } else if (EMBED_EXT.has(extname(name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

const assetsPlugin = {
  name: 'virtual-assets',
  setup(build) {
    build.onResolve({ filter: /^virtual:assets$/ }, () => ({ path: 'virtual:assets', namespace: 'virtual-assets' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual-assets' }, () => {
      const files = listAssets();
      const lines = files.map((f, i) => `import a${i} from ${JSON.stringify(f)};`);
      const entries = files.map((f, i) => `  ${JSON.stringify(relative(ASSET_DIR, f).split('\\').join('/'))}: a${i},`);
      return {
        contents: `${lines.join('\n')}\nexport default {\n${entries.join('\n')}\n};\n`,
        resolveDir: ROOT,
        loader: 'js',
        watchFiles: files,
      };
    });
  },
};

export function config({ minify = true } = {}) {
  return {
    entryPoints: [join(ROOT, 'js/main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    minify,
    sourcemap: false,
    legalComments: 'none',
    loader: { '.glb': 'binary', '.png': 'binary', '.jpg': 'binary', '.jpeg': 'binary', '.bin': 'binary', '.ktx2': 'binary' },
    plugins: [assetsPlugin],
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
    logLevel: 'warning',
  };
}
