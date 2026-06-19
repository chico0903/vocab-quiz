import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: change "base" below to match your GitHub repository name.
// If your repo URL is https://github.com/yourname/vocab-quiz,
// then base should be "/vocab-quiz/".
export default defineConfig({
  plugins: [react()],
  base: "/vocab-quiz/",
});
