import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".open-next.bak/**",
      "cloudflare-env.d.ts",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
