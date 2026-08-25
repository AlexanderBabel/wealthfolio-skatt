import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// A Swedish tax year is a local calendar year, so every date in this addon is
// read in the machine's own timezone - which makes the tests timezone
// dependent by nature. Pinning them to the timezone the addon is actually for
// keeps a CI runner on UTC honest: a trade at 22:00Z on 31 May is a 1 June
// trade in Stockholm, and the tests should assert the Stockholm answer.
process.env.TZ = 'Europe/Stockholm';

const hostProvidedDependencies = [
  '@tanstack/react-query',
  '@wealthfolio/addon-sdk',
  '@wealthfolio/addon-sdk/goal-progress',
  '@wealthfolio/addon-sdk/host-api',
  '@wealthfolio/addon-sdk/host-dependencies',
  '@wealthfolio/addon-sdk/manifest',
  '@wealthfolio/addon-sdk/permissions',
  '@wealthfolio/addon-sdk/query-keys',
  '@wealthfolio/addon-sdk/types',
  '@wealthfolio/addon-sdk/utils',
  '@wealthfolio/ui',
  '@wealthfolio/ui/chart',
  'date-fns',
  'lucide-react',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'recharts',
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    env: { TZ: 'Europe/Stockholm' },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: 'src/addon.tsx',
      fileName: () => 'addon.js',
      formats: ['es'],
    },
    outDir: 'dist',
    minify: true,
    sourcemap: false,
    rollupOptions: {
      external: hostProvidedDependencies,
    },
    // No `watch` here: it would make a plain `vite build` — and so `pnpm bundle`
    // — never exit. The dev script passes --watch when it wants one.
  },
});
