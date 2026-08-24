/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // argon2 native bindings must not be bundled into serverless traces incorrectly.
    serverComponentsExternalPackages: ['@node-rs/argon2', 'pino'],
  },
};

export default nextConfig;
