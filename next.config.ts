import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer ships its own reconciler, fonts and node deps — it
  // must stay an external server package or next build mangles it.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
