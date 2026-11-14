import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { moderationPlugin } from './server/moderation.js';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: new URL('./index.html', import.meta.url).pathname,
        presentation: new URL('./presentation.html', import.meta.url).pathname,
      },
    },
  },
  plugins: [moderationPlugin(), {
    name: 'example-media',
    async generateBundle() {
      for (const fileName of ['xqc1.txt', 'xqc1.mp4', 'xqc2.txt', 'xqc2.mp4']) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(new URL(fileName, import.meta.url)) });
      }
    },
  }],
});
