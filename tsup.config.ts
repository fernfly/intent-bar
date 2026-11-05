import { defineConfig, type Options } from 'tsup'

type Plugin = NonNullable<Options['esbuildPlugins']>[number]

/**
 * Replaces Radix Dialog with an empty module. cmdk imports it at the top of
 * its entry for `Command.Dialog`, which the bar never uses, so esbuild can't
 * drop it alone. Removing it takes about 11 KB gzipped off the IIFE.
 */
const withoutRadixDialog: Plugin = {
  name: 'without-radix-dialog',
  setup(build) {
    build.onResolve({ filter: /^@radix-ui\/react-dialog$/ }, () => ({ path: 'radix-dialog', namespace: 'empty' }))
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export {}', loader: 'js' }))
  },
}

/**
 * Two builds. The package build is ESM + CJS for React apps, with React left
 * to the host as a peer. The global build is one IIFE for a script tag, with
 * React and cmdk bundled in, since the host has neither.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom'],
    banner: { js: '"use client";' }, // tsup drops the directive from source, and Next's app router needs it
  },
  {
    entry: { 'intent-bar': 'src/global/index.ts' },
    format: ['iife'],
    globalName: 'FernflyIntentBar',
    minify: true,
    sourcemap: true,
    noExternal: [/.*/],
    define: { 'process.env.NODE_ENV': '"production"' },
    esbuildPlugins: [withoutRadixDialog],
    outExtension: () => ({ js: '.global.js' }),
  },
])
