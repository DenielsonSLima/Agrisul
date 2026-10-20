import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository's project-specific AGENTS.md under source control.
  agentRules: false,
  // npm run dev uses Next; production uses Vite with the same public values.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
};

export default nextConfig;
