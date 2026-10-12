import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native module, only used server-side.
  // KML uploads (2 MB at most, see MAX_KML_BYTES) are posted to a server action.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  serverExternalPackages: ["onnxruntime-node", "@node-rs/argon2"],
};

export default nextConfig;
