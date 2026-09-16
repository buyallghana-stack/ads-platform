import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  /*
    The operational scripts in scripts/*.cjs are CommonJS deliberately, so that
    `require('pg')` resolves from node_modules when node runs them directly.
    They are never imported by the app and are not in its bundle.

    `no-require-imports` is aimed at TypeScript source, where an import is
    always available. In a .cjs file require IS the import syntax, so the rule
    has nothing to suggest and produces noise that hides real findings.
  */
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
