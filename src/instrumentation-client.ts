import { initBotId } from "botid/client/core";

// Routes BotID protects; the route itself calls checkBotId().
initBotId({
  protect: [{ path: "/api/battle", method: "POST" }],
});
