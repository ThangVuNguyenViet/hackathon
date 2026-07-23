import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distUrl = new URL('../dist/', import.meta.url);

await rm(fileURLToPath(distUrl), {
  force: true,
  recursive: true,
});
