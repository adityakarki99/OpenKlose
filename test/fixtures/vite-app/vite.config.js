// The repo's own config: Klose's harness server must pick this up.
export default {
  esbuild: { jsx: 'automatic' },
  define: { __FIXTURE_CONFIG__: JSON.stringify('config-applied') },
};
