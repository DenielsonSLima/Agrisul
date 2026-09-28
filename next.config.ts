import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository's project-specific AGENTS.md under source control.
  agentRules: false,
};

export default nextConfig;
