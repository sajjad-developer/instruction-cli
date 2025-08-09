import pluginJs from "@eslint/js";
import globals from "globals";

export default [
  {
    languageOptions: {
      // This section makes ESLint aware of Node.js globals
      globals: {
        ...globals.node,
      },
    },
  },
  pluginJs.configs.recommended,
];
