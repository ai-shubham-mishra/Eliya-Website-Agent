import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Expose vars prefixed with VITE_ (default) or API_ (for API_BASE_URL) to client code
  envPrefix: ['VITE_', 'API_'],
  server: {
    port: 3000,
    host: true,
  },
});
