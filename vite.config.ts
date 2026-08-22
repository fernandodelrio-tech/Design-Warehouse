import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The content security policy the hosted build runs under, injected as a meta
 * tag — without it the deployed app has no policy at all.
 *
 * Build output only: the dev server needs inline scripts and a websocket for hot
 * reload, and relaxing the shipped policy to suit it would defeat the point.
 */
const CSP = [
  "default-src 'self'",
  // Google Identity Services is the one third-party script, and it is only
  // fetched if you choose to sign in.
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline'",
  // blob: and data: cover the thumbnails the app builds in the page itself.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: https://www.googleapis.com https://accounts.google.com",
  "media-src 'self' blob:",
  // Sign-in renders in a Google iframe.
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy() {
  return {
    name: 'design-warehouse-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
  server: { port: 5173, open: false },
  build: { outDir: 'dist', sourcemap: true },
});
