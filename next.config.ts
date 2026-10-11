import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native module, only used server-side.
  serverExternalPackages: ["onnxruntime-node"],
};

export default nextConfig;
