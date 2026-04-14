import { Redis } from "@upstash/redis";

import { env } from "@/env";

const LATEST_ONPE_IMAGE_URL_KEY = "onpe:latest-image-url";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export async function getLatestOnpeImageUrl() {
  return redis.get<string>(LATEST_ONPE_IMAGE_URL_KEY);
}

export async function setLatestOnpeImageUrl(url: string) {
  await redis.set(LATEST_ONPE_IMAGE_URL_KEY, url);
}
