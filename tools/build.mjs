// Builds the self-contained, double-clickable index.html (works from file://, no network, no server).
// Usage: node tools/build.mjs [--no-minify]
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './esbuild.config.mjs';

const minify = !process.argv.includes('--no-minify');
const t0 = Date.now();
const result = await esbuild.build({ ...config({ minify }), write: false });
let js = result.outputFiles[0].text;
// An inline <script> must never contain a literal "</script" sequence.
js = js.replace(/<\/script/gi, '<\\/script');

const template = readFileSync(join(ROOT, 'js/shell.html'), 'utf8');
const [head, tail] = template.split('<!--BUNDLE-->');
if (tail === undefined) throw new Error('js/shell.html is missing the <!--BUNDLE--> marker');
const html = `${head}<script>${js}</script>${tail}`;
writeFileSync(join(ROOT, 'index.html'), html);
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
console.log(`index.html written: ${mb} MB in ${Date.now() - t0} ms`);
