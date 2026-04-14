import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { env } from "@/env";

function createDb() {
  const client = neon(env.DATABASE_URL);

  return drizzle({ client, schema });
}

let db: ReturnType<typeof createDb> | undefined;

export function getDb() {
  db ??= createDb();

  return db;
}
