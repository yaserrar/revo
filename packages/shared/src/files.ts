/** Shiki language id for a repo path, or 'text' when unknown. */
const BY_EXTENSION: Record<string, string> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  json: 'json',
  prisma: 'prisma',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'md',
  mdx: 'mdx',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  php: 'php',
  sh: 'bash',
  toml: 'toml',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
};

export const SNIPPET_LANGUAGES = [...new Set(Object.values(BY_EXTENSION))];

export function languageForPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  if (base === 'Dockerfile') return 'docker';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return BY_EXTENSION[ext] ?? 'text';
}

/** Splits owner/name. */
export function splitFullName(fullName: string): { owner: string; name: string } {
  const [owner = '', name = ''] = fullName.split('/');
  return { owner, name };
}
