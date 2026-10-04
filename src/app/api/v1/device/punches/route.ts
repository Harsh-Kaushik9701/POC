import { z } from "zod";
import { deviceFromRequest, deviceError } from "@/server/device";
import { recordPunch, PunchError } from "@/server/punch";
import { appNow } from "@/lib/time";

const Event = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  type: z.enum(["CLOCK_IN", "CLOCK_OUT", "TASK_START", "TASK_PAUSE", "TASK_FINISH", "CODE_START", "CODE_END", "BREAK_START", "BREAK_END", "VOID"]),
  taskId: z.string().uuid().nullish(),
  timeCodeId: z.string().uuid().nullish(),
  supersedesEventId: z.string().uuid().nullish(),
  credentialId: z.string().uuid().nullish(),
  method: z.enum(["nfc", "qr", "pin"]),
  deviceTime: z.number(),
  offline: z.boolean().default(false),
  photoKey: z.string().max(80).nullish(),
});
const Body = z.object({ sentAt: z.number(), events: z.array(Event).min(1).max(200) });

/**
 * Kiosk punches, one or a queued batch. Idempotent per event id.
 * Trusted time: events sent live use the server clock; queued offline events use the device time,
 * corrected by the device's clock offset measured at send time, and are flagged for review.
 */
export async function POST(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return deviceError();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request", detail: parsed.error.issues.slice(0, 3) }, { status: 400 });
  const serverNow = appNow();
  const skew = serverNow - parsed.data.sentAt;
  const results = [];
  for (const e of parsed.data.events) {
    const at = e.offline ? Math.min(e.deviceTime + skew, serverNow) : serverNow;
    try {
      const r = await recordPunch({
        id: e.id, employeeId: e.employeeId, type: e.type, at, deviceTime: e.deviceTime, taskId: e.taskId, timeCodeId: e.timeCodeId,
        supersedesEventId: e.supersedesEventId, credentialId: e.credentialId, deviceId: device.id, method: e.method,
        source: device.kind === "station" ? "station" : device.kind === "supervisor" ? "supervisor" : "kiosk",
        wasOffline: e.offline, photoKey: e.photoKey, flags: e.photoKey ? [] : ["no_photo"],
      });
      results.push({ id: e.id, ok: true, state: r.state });
    } catch (err) {
      if (err instanceof PunchError) results.push({ id: e.id, ok: false, error: err.message });
      else { console.error(err); results.push({ id: e.id, ok: false, error: "Server error. Try again." }); }
    }
  }
  return Response.json({ serverNow, results });
}
