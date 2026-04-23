/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_PI_SANDBOX: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
