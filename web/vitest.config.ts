import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'jsdom',include:['tests/*.test.tsx'],setupFiles:['tests/setup.ts'],testTimeout:20000,pool:'forks',maxWorkers:1,
  // Drawnix's published builds import 'roughjs/bin/rough' without an extension, which Vite resolves and
  // plain Node does not, so the tests run them through Vite as the app build does.
  server:{deps:{inline:['@drawnix/drawnix','@plait-board/react-board','@plait-board/react-text']}}}});
