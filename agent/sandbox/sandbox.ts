import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";

// The root agent has no shell or file tools (agent/tools/*.ts), so its sandbox
// is never driven. Pin the pure-JS one rather than letting DefaultSandbox pick
// Docker or a VM on whichever host this runs: nothing native, nothing to start.
// S6 replaces this with vercel() under a deny-all policy for deployed mode.
export const environment = JustBashSandbox.environment({ autoInstall: false });
export default defineSandbox(() => environment.open());
