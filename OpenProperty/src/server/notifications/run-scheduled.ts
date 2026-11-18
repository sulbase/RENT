import { createDbHandle } from "../db";
import type { WorkerBindings } from "../env";
import { generateMailboxAlerts } from "./alerts";
import { generateLateNotices } from "./late-notice";

/** Cron entry. Awaited by the scheduled handler so a failure is visible on the trigger. */
export async function runScheduledAlerts(env: WorkerBindings): Promise<void> {
  const handle = createDbHandle(env);
  try {
    const summary = await generateMailboxAlerts(handle.sql);
    const lateNotices = await generateLateNotices(handle.sql);
    console.log(JSON.stringify({ msg: "mailbox alerts", ...summary, lateNotices }));
  } finally {
    await handle.close();
  }
}
