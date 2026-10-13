import worker from "./index.js";
import { withBestEffortKv } from "./kv-safe-env.js";

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, withBestEffortKv(env), ctx);
  },
  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, withBestEffortKv(env), ctx);
  },
};
