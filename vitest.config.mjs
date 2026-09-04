import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    // Nested git worktrees under .claude/worktrees/ are full separate copies of
    // every file — without this, Vitest discovers and runs each test twice when
    // run from the main checkout while a worktree is alive alongside it.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '.claude/worktrees/**',
    ],
  },
});
