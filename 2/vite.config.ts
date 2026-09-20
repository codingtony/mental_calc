import { defineConfig } from "vite";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  plugins: [
    // Pre-gzip assets for S3 static hosting: CI strips the .gz suffix and
    // uploads with Content-Encoding: gzip, so browsers get compressed files.
    viteCompression({
      algorithm: "gzip",
      threshold: 0,
      deleteOriginFile: true,
    }),
  ],
});
