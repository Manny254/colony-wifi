/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Secrets must only ever be read server-side (route handlers / server components).
  // Nothing here is exposed to the browser bundle unless prefixed NEXT_PUBLIC_.
};

module.exports = nextConfig;
