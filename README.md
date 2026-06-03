# Verita-AI-Take-Home-Project-Metered-API-Billing

Correctness-first metered API billing MVP.

## Workspace Layout

* `backend/`: Express + TypeScript API and background jobs
* `frontend/`: React + Vite dashboard and ops console

## Local Setup

1. Copy `.env.example` to `.env`.
2. Start Postgres with `docker compose up -d`.
3. Install workspace dependencies with `npm install`.
4. Run database migrations with `npm --workspace backend run migrate:up`.
5. Run the frontend with `npm run dev:frontend`.
6. Run the backend with `npm run dev:backend`.

## Root Commands

* `npm run build`
* `npm run lint`
* `npm run typecheck`
* `npm run test`
