import { initBotId } from "botid/client/core";

// Tell BotID which routes to protect. The server checks with checkBotId().
initBotId({
  protect: [{ path: "/api/battle", method: "POST" }],
});
