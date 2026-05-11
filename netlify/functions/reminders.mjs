import { processBookingReminders } from "../../server.mjs";

export default async function handler() {
  const origin = process.env.PUBLIC_APP_URL || process.env.URL || "";
  await processBookingReminders(origin);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true })
  };
}
