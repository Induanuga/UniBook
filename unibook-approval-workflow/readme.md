## UniBook — Approval Workflow (Subsystem 4)

### Setup

#### PostgreSQL (run once)

```bash
sudo -i -u postgres
psql
```

```sql
CREATE DATABASE unibook_approval OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook_approval TO unibook;
\q
```

```bash
exit
```

### Environment

```bash
cp .env.example .env
```

Edit `.env` and set:
1. `JWT_SECRET` — must match the value in `unibook-iam-backend/.env` exactly
2. `DATABASE_URL` — point to your PostgreSQL `unibook_approval` database
3. `BOOKING_ENGINE_DATABASE_URL` — read-only access to `unibook_booking` for booking details

### Run

```bash
npm install
npm run db:migrate
npm run dev       # starts on :3004
```

### Test

```bash
npm test          # ~40 tests, no DB needed
npm run test:coverage
```

### Key Design Patterns

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Chain of Responsibility** | `handlers/` | Routes bookings to faculty or admin approvers based on requester role |
| **Repository** | `repositories/ApprovalRepository.ts` | Encapsulates all DB access |
| **Singleton** | `db/index.ts` | Shared pool across all repositories |
| **Observer** | `notifyBookingEngine()` | Propagates approval decisions back to Booking Engine |

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/approvals/pending` | FACULTY / ADMIN | My pending approvals to act on |
| `GET` | `/approvals/my` | Any | My submitted booking approvals |
| `GET` | `/approvals/:id` | Owner / FACULTY / ADMIN | Get approval by ID |
| `GET` | `/approvals/booking/:bookingId` | Owner / FACULTY / ADMIN | Get approval for a booking |
| `POST` | `/approvals/:id/decide` | FACULTY / ADMIN | Record approve/reject/suggest-alternative |
| `POST` | `/approvals/internal/booking-submitted` | Service Key | Internal — from Booking Engine |
| `GET` | `/health` | Public | Health check |
