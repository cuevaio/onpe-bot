import { Redis } from "@upstash/redis";

import { env } from "@/env";

export type OnpeTopCount = 3 | 5;

function getLatestOnpeImageUrlKey(topCount: OnpeTopCount) {
  return `onpe:latest-image-url:top-${topCount}`;
}

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export async function getLatestOnpeImageUrl(topCount: OnpeTopCount) {
  return redis.get<string>(getLatestOnpeImageUrlKey(topCount));
}

export async function setLatestOnpeImageUrl(topCount: OnpeTopCount, url: string) {
  await redis.set(getLatestOnpeImageUrlKey(topCount), url);
}
