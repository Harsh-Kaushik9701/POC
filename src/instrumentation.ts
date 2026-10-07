/** Runs once when each server instance starts: anchor the demo clock to when the demo data was loaded. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DEMO_NOW) return;
  const { refreshDemoAnchor } = await import("./server/clock");
  await refreshDemoAnchor();
}
