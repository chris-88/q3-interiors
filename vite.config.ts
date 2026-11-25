import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { SITE_URL } from './supabase/functions/_shared/site.ts'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
    {
      // Absolute URLs in index.html (link previews) come from the one SITE_URL value. The staff
      // build (VITE_SURFACE=staff) drops the link previews and asks not to be indexed.
      name: 'q3-site-url',
      transformIndexHtml: (html) =>
        process.env.VITE_SURFACE === 'staff'
          ? html
              .replace(/\s*<!-- Link previews\.[\s\S]*?<meta name="twitter:image"[^>]*\/>/, '')
              .replace('<title>Q3 Interiors</title>', '<title>Q3 Interiors Staff</title>')
              .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, '')
              .replace(
                '<meta name="color-scheme" content="light" />',
                '<meta name="color-scheme" content="light" />\n    <meta name="robots" content="noindex, nofollow" />',
              )
              .replaceAll('%SITE_URL%', SITE_URL)
          : html.replaceAll('%SITE_URL%', SITE_URL),
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
    },
  },
})
