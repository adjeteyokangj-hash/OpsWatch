module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  ignorePatterns: ["dist/", ".next/", "node_modules/"],
  rules: {}
};
