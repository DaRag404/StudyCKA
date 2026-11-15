import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url),
  dist = new URL('../dist/', import.meta.url);
const html = (await readFile(new URL('index.html', dist), 'utf8'))
  .replace('type="module" crossorigin', 'defer')
  .replace('rel="stylesheet" crossorigin', 'rel="stylesheet"');
await mkdir(new URL('assets/', root), { recursive: true });
for (const file of ['assets/studycka.js', 'assets/studycka.css'])
  await copyFile(new URL(file, dist), new URL(file, root));
await writeFile(new URL('index.html', root), html);
