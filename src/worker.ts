import "dotenv/config";
import { run } from "graphile-worker";
import { env } from "@/lib/env";
import { taskList } from "@/jobs/tasks";

async function main() {
  const runner = await run({
    connectionString: env().DATABASE_URL,
    concurrency: 5,
    noHandleSignals: false,
    pollInterval: 1000,
    taskList,
    crontab: "17 3 * * * refresh_tokens",
  });
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
