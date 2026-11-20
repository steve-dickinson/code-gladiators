import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// withBotId adds the rewrites BotID needs to run its invisible challenge.
// withWorkflow compiles "use workflow" and "use step" functions into durable workflows.
export default withWorkflow(withBotId(nextConfig));
