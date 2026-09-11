import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 商业引擎位于仓库根（git008），Turbopack 需显式声明 monorepo root 才能解析其外部模块 */
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
};

export default nextConfig;
