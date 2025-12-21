/// <reference types="vite/client" />

// When and why is this needed?? -- https://vitejs.dev/guide/env-and-mode.html

interface ImportMetaEnv {
  readonly VITE_AIQA_SERVER_URL: string;
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

























