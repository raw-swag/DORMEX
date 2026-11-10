declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare const __DORMEX_IS_PROD__: boolean;
declare const __VITE_ENABLE_DEMO_ACCESS__: boolean;
