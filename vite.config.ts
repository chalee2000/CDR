/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * read-excel-file parses a sheet's XML in small chunks: after each chunk it
 * re-slices the rest of the XML string and re-copies every row read so far,
 * and it steps to the next chunk by calling itself. Real exports can carry a
 * million formatted empty rows (a 59 MB sheet for 540 records), which makes
 * this slow and, in some runtimes, overflows the call stack. The chunks only
 * serve progress reporting, which the app does not use, so parse each sheet
 * in one pass and report completion once. The build fails if the library
 * changes shape, so the fix cannot silently go away.
 */
function singlePassSheetXml(): Plugin {
  const CHUNKED = /if \(onProgress\) \{\s*parseXmlInChunks\(parser, xml, onProgress\);\s*\}/;
  return {
    name: 'read-excel-file-single-pass',
    enforce: 'pre',
    transform(code, id) {
      if (!/read-excel-file[\\/].*[\\/]xml[\\/]parseXml\.js$/.test(id)) return null;
      if (!CHUNKED.test(code)) throw new Error(`read-excel-file changed: chunked parsing not found in ${id}`);
      return code.replace(CHUNKED, 'if (onProgress) {\n    parser.write(xml);\n    parser.end();\n    onProgress(true);\n  }');
    },
  };
}

// Build to one self-contained dist/index.html so the app runs from file://,
// from GitHub Pages under any sub-path, and fully offline.
export default defineConfig({
  base: './',
  plugins: [singlePassSheetXml(), react(), viteSingleFile()],
  // The dev server pre-bundles dependencies without plugins: keep this one
  // out so the fix applies there too.
  optimizeDeps: { exclude: ['read-excel-file'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Unit tests import the library through Vite too, so they get the fix.
    server: { deps: { inline: ['read-excel-file'] } },
  },
});
