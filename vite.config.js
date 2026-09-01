import { defineConfig } from 'vite'

/**
 * @type {import('vite').UserConfig}
 */
export default defineConfig({
  // Relative base so the same `dist/` works from a domain root (Vercel/Netlify)
  // or a sub-path (GitHub Pages project site). Same pattern as minecraft-JS.
  base: './',
  build: {
    sourcemap: true,
    outDir: 'dist'
  }
})
