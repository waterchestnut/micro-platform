import { configUmiAlias, createConfig } from '@umijs/max/test';

export default async () => {
  const config = await configUmiAlias({
    ...createConfig({
      target: 'browser',
    }),
  });
  console.log(JSON.stringify(config));

  return {
    ...config,
    /**
     * 覆盖 `@umijs/max/test` 自带的 `transformIgnorePatterns: ['/node_modules/(?!)']`。
     * 那个空负向前瞻 `(?! )` **永远匹配不上**，效果等于"node_modules 里每个文件都要过 babel"，
     * 于是 `react-dom/test-utils.js` 会撞上链上的 `@babel/core@7.4.5`：
     * `Cannot find module '@babel/plugin-transform-modules-commonjs'`（或版本要求不匹配）。
     * 这一行的全部作用是**让测试不去转换三方包的 CJS 产物**，本仓自己的 `.ts/.tsx` 仍走原 transform。
     * 没有它，任何 `import '@testing-library/react'` 的套件都是一进来就整体失败——
     * 看起来像"要动全局依赖才能修"，实际只是转换范围写错。
     * 若将来某个 ESM-only 三方包必须被转换，把它的名字加进这条正则的例外里，别退回"全部转换"。
     */
    transformIgnorePatterns: ['/node_modules/'],
    testEnvironmentOptions: {
      ...(config?.testEnvironmentOptions || {}),
      url: 'http://localhost:8000',
    },
    setupFiles: [...(config.setupFiles || []), './tests/setupTests.jsx'],
    globals: {
      ...config.globals,
      localStorage: null,
    },
  };
};
