// Lint rules: ESLint's recommended set, with the browser's globals for the game.
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: { globals: globals.browser },
    rules: {
      // Arguments named like _game are unused on purpose, such as in methods subclasses override
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
