import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 源码按 NodeNext 写 .js 后缀，这里在测试环境把它们映射回 .ts。
    alias: [{ find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' }],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
