/* eslint-env node, es2018 */
module.exports = {
  extends: [require.resolve('@jcoreio/toolchain/eslint.config.cjs')],
  env: {
    commonjs: true,
    node: true,
    es2017: true,
  },
}
