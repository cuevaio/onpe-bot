import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    KAPSO_WEBHOOK_SECRET: z.string().min(1),
    KAPSO_API_KEY: z.string().min(1),
    KAPSO_PHONE_NUMBER_ID: z.string().min(1),
  },
  client: {},
  runtimeEnv: {
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    KAPSO_WEBHOOK_SECRET: process.env.KAPSO_WEBHOOK_SECRET,
    KAPSO_API_KEY: process.env.KAPSO_API_KEY,
    KAPSO_PHONE_NUMBER_ID: process.env.KAPSO_PHONE_NUMBER_ID,
  },
});
