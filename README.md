# ONPE Bot

WhatsApp bot that monitors ONPE presidential results, regenerates a latest chart image when ONPE publishes a new update, and broadcasts the image to registered users.

## How It Works

1. `trigger/monitor-election.ts` runs every 2 minutes.
2. It fetches ONPE summary data from `resumen-general/totales`.
3. It compares `fechaActualizacion` against the last stored summary blob.
4. When ONPE publishes a new update, it:
   - fetches the latest candidate snapshot
   - stores `onpe/latest.json`
   - stores `onpe/latest-summary.json`
   - regenerates `onpe/charts/chart-latest.png`
   - sends a WhatsApp broadcast
5. The chart image shows:
   - top 3 candidates
   - valid votes and vote percentages
   - `Actas contabilizadas`
   - ONPE's update timestamp

## Storage

Public blob paths used by the app:

- `onpe/latest.json`: latest candidate snapshot
- `onpe/latest-summary.json`: latest summary metadata with `fechaActualizacion` and `actasContabilizadas`
- `onpe/charts/chart-latest.png`: latest generated chart image

## WhatsApp Flow

- Users are registered when they send an inbound WhatsApp message handled by `app/api/webhooks/kapso/route.ts`.
- Registered numbers are stored in `whatsapp_senders`.
- Broadcast sends are resolved inside `trigger/send-results-image.ts`.
- Non-template image sends are limited by WhatsApp's 24-hour customer-care window.
- The current implementation skips recipients whose most recent inbound message is older than 24 hours, instead of failing the whole batch.

If you want true broadcasts to all registered users regardless of the 24-hour window, add an approved WhatsApp template and send templates for out-of-window recipients.

## Environment Variables

Required server variables:

```bash
BLOB_READ_WRITE_TOKEN=
DATABASE_URL=
KAPSO_WEBHOOK_SECRET=
KAPSO_API_KEY=
KAPSO_PHONE_NUMBER_ID=
```

## Local Development

Install dependencies:

```bash
npm install
```

Run Next.js:

```bash
npm run dev
```

Run checks:

```bash
npm run lint
npx tsc --noEmit
```

## Database

Generate and run migrations with Drizzle:

```bash
npm run db:generate
npm run db:migrate
```

Open Drizzle Studio:

```bash
npm run db:studio
```

## Trigger.dev

Tasks live in `trigger/` and are configured in `trigger.config.ts`.

Key tasks:

- `monitor-election.ts`: polling and orchestration
- `fetch-summary-metadata.ts`: summary freshness source
- `fetch-snapshot.ts`: candidate snapshot fetch
- `render-results-image.ts`: chart generation
- `send-results-image.ts`: WhatsApp broadcast

## Webhook Registration

`app/api/webhooks/kapso/route.ts`:

- verifies the Kapso signature
- stores delivery idempotency
- upserts the sender phone number
- sends the latest chart image to newly registered users

## Notes

- ONPE freshness is determined only by `fechaActualizacion`.
- The image uses `actasContabilizadas` from the summary endpoint as the main headline stat.
- The latest image is regenerated immediately after each detected ONPE update and on first initialization.
