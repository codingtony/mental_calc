import { defineConfig } from "vite";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  // Relative asset URLs: the bundle works at / and in any subpath.
  base: "./",
  plugins: [
    // Pre-gzip assets for S3 static hosting: CI strips the .gz suffix and
    // uploads with Content-Encoding: gzip, so browsers get compressed files.
    viteCompression({
      algorithm: "gzip",
      threshold: 0,
      // Default filter skips .glb; CI labels every dist file gzip, so the
      // models must be pre-compressed too.
      filter: /\.(js|mjs|json|css|html|glb)$/i,
      deleteOriginFile: true,
    }),
  ],
});
