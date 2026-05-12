import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // bkstr S3 bucket for publisher-uploaded book cover images.
        // Bucket: bkstr-tmrw-prod (us-east-1)
        // Key pattern: book-covers/<bookId>.<ext>
        protocol: "https",
        hostname: "bkstr-tmrw-prod.s3.us-east-1.amazonaws.com",
        pathname: "/book-covers/**",
      },
    ],
  },
};

export default nextConfig;
