/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Solana/Meteora packages ship CJS with dynamic requires; keep them out of
  // the server bundle so the API route can load them natively.
  serverExternalPackages: [
    "@meteora-ag/dynamic-bonding-curve-sdk",
    "@solana/web3.js",
    "@solana/spl-token",
    "bn.js",
  ],
};

export default nextConfig;
