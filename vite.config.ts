import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so one build runs from a domain root, a GitHub Pages
  // project path, or any other subdirectory without being rebuilt for it.
  base: './',
  build: { target: 'es2022' },
});
