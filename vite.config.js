import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  plugins: [{
    name: 'example-media',
    async generateBundle() {
      for (const fileName of ['xqc1.txt', 'xqc1.mp4']) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(new URL(fileName, import.meta.url)) });
      }
    },
  }],
});
