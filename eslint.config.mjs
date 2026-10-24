import js from "@eslint/js";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        alert: "readonly",
        Blob: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        FileReader: "readonly",
        firebase: "readonly",
        Image: "readonly",
        L: "readonly",
        localStorage: "readonly",
        MediaRecorder: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", vars: "local" }],
    },
  },
]);
