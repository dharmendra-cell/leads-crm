import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/onnx packages must not be bundled by webpack.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "@prisma/client"],
  // The local embedding model (~370MB) exceeds Vercel's 250MB function limit; production uses HF_TOKEN embeddings instead.
  outputFileTracingExcludes: {
    "/*": ["./node_modules/onnxruntime-node/**", "./node_modules/onnxruntime-web/**", "./node_modules/@huggingface/transformers/**", "./node_modules/sharp/**"],
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
