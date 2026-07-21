import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build modes:
//  - default: multi-page (overlay + control panel) for hosting / dev
//  - single:  the overlay inlined into ONE html file (what streamers download)
export default defineConfig(({ mode }) => {
  if (mode === 'single') {
    return {
      plugins: [viteSingleFile()],
      build: {
        outDir: 'dist-single',
        chunkSizeWarningLimit: 1200,
        rollupOptions: { input: 'index.html' },
      },
    };
  }
  return {
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        input: { overlay: 'index.html', control: 'control.html' },
      },
    },
  };
});
