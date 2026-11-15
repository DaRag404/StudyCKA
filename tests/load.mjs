import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
// Exercise the actual lab scripts in the same order as the offline page.
for (const [, file] of html.matchAll(/<script defer src="([^"]+)"/g)) {
  if (!/^(js\/init\.js|vendor\/(bash|yaml)\.js|js\/lab\/|exercises\/)/.test(file)) continue;
  runInThisContext(readFileSync(new URL(file, root), 'utf8'), { filename: file });
}
