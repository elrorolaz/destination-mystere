/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Image Docker autonome (voir Dockerfile) : build « standalone ».
  output: "standalone",
};

export default nextConfig;
