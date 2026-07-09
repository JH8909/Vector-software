import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 避免 monorepo 根目录误识别导致 dev/build 异常
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  webpack: (config, { isServer }) => {
    config.module?.rules?.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    // VTracer WASM glue uses async wasm init in browser only
    if (!isServer) {
      config.experiments = { ...config.experiments, asyncWebAssembly: true };
    }
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      // Ensure wasm glue resolves sibling .wasm asset
      "@vtracer-wasm": path.resolve(__dirname, "src/lib/vectorizer/vendor/vtracer_webapp.js"),
    };
    return config;
  },
};

export default nextConfig;
