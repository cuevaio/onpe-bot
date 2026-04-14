<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo uses `next@16.2.3` and `react@19.2.4`. Read the relevant guide in `node_modules/next/dist/docs/` before changing framework-level code, and trust local config over memory.
<!-- END:nextjs-agent-rules -->

# Repo Notes

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Production build: `npm run build`
- Drizzle generate: `npm run db:generate`
- Drizzle migrate: `npm run db:migrate`
- Drizzle Studio: `npm run db:studio`
- There is no test script and no test files in the repo today.

## Verification

- Default focused verification is `npm run lint` then `npx tsc --noEmit`.
- Run `npm run build` only when changes touch routing, env usage, or Next.js integration points.

## Architecture

- This is a single-package Next.js app, not a monorepo.
- `app/api/webhooks/kapso/route.ts` is the real inbound entrypoint. It verifies Kapso signatures, deduplicates deliveries, registers phone numbers, and sends the latest image to first-time senders.
- `trigger/monitor-election.ts` is the main orchestration task. It polls ONPE every 5 minutes, compares `fechaActualizacion`, persists the latest snapshot/summary, regenerates the chart image, and triggers outbound alerts.
- `trigger/` contains the operational workflow. Read those tasks before changing ONPE fetch, image generation, or broadcast behavior.
- `lib/onpe.ts` is the source of truth for ONPE endpoints, blob paths, request headers, and freshness semantics.
- `db/schema.ts` defines the only current tables: `whatsapp_senders` and `kapso_webhook_deliveries`.

## Repo-Specific Gotchas

- ONPE freshness is determined only by `fechaActualizacion`; do not invent other change detection without updating the workflow intentionally.
- The ONPE backend requires browser-like headers from `lib/onpe.ts`; otherwise it can return the SPA HTML instead of JSON.
- Broadcast sends intentionally skip recipients whose last inbound WhatsApp message is older than 24 hours. That behavior lives in `trigger/send-results-image.ts`.
- The webhook route is explicitly `runtime = "nodejs"` and uses `node:crypto`; keep it on the Node runtime.
- Env validation is strict through `env.ts`. Any server-side import of `env` requires all listed variables to be present.
- Latest image URL caching is done in Upstash Redis via `lib/cache.ts`; new-user welcome sends fall back to the public blob URL constant if the cache is empty.

## Data And Storage

- Public blob paths are fixed in `lib/onpe.ts`:
- `onpe/latest.json`
- `onpe/latest-summary.json`
- `onpe/charts/chart-latest.png`

## UI Status

- `app/page.tsx` is still the default starter page. Most product behavior is in the webhook and Trigger.dev tasks, not the UI.

## Style And Tooling

- ESLint uses `eslint-config-next` core-web-vitals plus TypeScript rules via `eslint.config.mjs`.
- Tailwind is v4 with `@import "tailwindcss"` in `app/globals.css`; do not assume older Tailwind config patterns exist here.
- TypeScript path alias is `@/*` from the repo root.
