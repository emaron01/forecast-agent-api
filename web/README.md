# Forecast Agent WebRTC Test Bed

Minimal Next.js WebRTC client to test mic/speaker with OpenAI Realtime (no Twilio).

## Setup

1) Create `web/.env.local` with:
```
MODEL_API_KEY=your_openai_api_key
MODEL_API_NAME=gpt-4o-realtime-preview
MODEL_VOICE=verse
```

2) Install deps and run:
```
cd web
npm install
npm run dev
```

3) Open: http://localhost:3000

## Notes
- This is a test harness only (no DB, no tool routing yet).
- We will wire the existing prompt builder + tool calls next.
- WebRTC uses `/api/session` which proxies the SDP to OpenAI Realtime.

## Render: Background Worker for Staged Ingestion

Large Excel uploads (>200 rows) are processed asynchronously via BullMQ. On Render:

1. Create a **Background Worker** service.
2. **Start command:** `npm run worker:ingest`
3. Copy env vars from your Web Service: `REDIS_URL`, `DATABASE_URL`, `MODEL_API_*` (and any other DB/model vars).
4. Ensure a Redis instance (e.g. Render Redis) is provisioned and `REDIS_URL` is set for both Web and Worker.
