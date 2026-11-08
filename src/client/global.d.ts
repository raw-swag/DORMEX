declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare const __DORMEX_IS_PROD__: boolean;
