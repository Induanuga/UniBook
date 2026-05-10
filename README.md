# UniBook — Shared Resource Booking System

## Project Structure

```
UniBook/
├── unibook-iam-backend/           ← Subsystem 1: IAM (port 3001)
├── unibook-resource-catalogue/    ← Subsystem 2: Resource Catalogue (port 3003)
├── unibook-booking-engine/        ← Subsystem 3: Booking Engine (port 3002)
├── unibook-approval-workflow/     ← Subsystem 4: Approval Workflow (port 3004)
├── unibook-notification-service/  ← Subsystem 5: Notification Service (port 3005)
├── unibook-analytics-service/     ← Subsystem 6: Analytics & Reporting (port 3006)
├── SE-A3/                         ← Frontend (port 5173)
├── setup.sh                       ← One-time bootstrap script
└── rEADME.md                      ← This file
```

---

## Quick Start (after cloning)

### Step 1 — Install PostgreSQL

```bash
psql --version   # check if installed
```

If not installed:
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib -y
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Step 2 — Install Redis

Redis is required for the Resource Catalogue caching layer (Subsystem 2).

```bash
redis-cli --version   # check if installed
```

If not installed:
```bash
sudo apt update
sudo apt install redis-server -y
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

Verify:
```bash
redis-cli ping   # should respond: PONG
```

### Step 3 — Create databases (run once)

```bash
sudo -i -u postgres psql
```

Inside psql:
```sql
CREATE USER unibook WITH PASSWORD 'unibook123';

CREATE DATABASE unibook OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook TO unibook;

CREATE DATABASE unibook_booking OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook_booking TO unibook;

CREATE DATABASE unibook_resource OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook_resource TO unibook;

CREATE DATABASE unibook_approval OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook_approval TO unibook;

CREATE DATABASE unibook_notification OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook_notification TO unibook;

CREATE DATABASE unibook_analytics OWNER unibook;
GRANT ALL PRIVILEGES ON DATABASE unibook_analytics TO unibook;
\q
```
```bash
GRANT ALL PRIVILEGES ON DATABASE unibook TO unibook;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO unibook;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO unibook;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO unibook;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO unibook;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO unibook;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO unibook;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO unibook;
sudo -u postgres psql -d unibook -f schema.sql

\c unibook
ALTER TABLE users OWNER TO unibook;
GRANT ALL PRIVILEGES ON TABLE users TO unibook;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO unibook;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO unibook;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO unibook;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO unibook;
```
Then exit:
```bash
exit
```

### Step 4 — Set up .env files

**Frontend** (`SE-A3/.env`):
```env
VITE_API_URL=http://localhost:3001
VITE_BOOKING_API_URL=http://localhost:3002
VITE_RESOURCE_API_URL=http://localhost:3003
VITE_APPROVAL_API_URL=http://localhost:3004
VITE_NOTIFICATION_API_URL=http://localhost:3005
VITE_ANALYTICS_API_URL=http://localhost:3006
```

**IAM Backend** (`unibook-iam-backend/.env`):
```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook
JWT_SECRET=unibook-super-secret-key-change-in-production-min-256-bits
JWT_EXPIRES_IN=8h
JWT_REFRESH_SECRET=unibook-refresh-secret-key-change-in-production
JWT_REFRESH_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
CAS_SERVER_URL=https://login.iiit.ac.in/cas
CAS_SERVICE_URL=http://localhost:3001/auth/cas/callback
CAS_DEFAULT_ROLE=STUDENT
```

**Booking Engine** (`unibook-booking-engine/.env`):
```env
PORT=3002
NODE_ENV=development
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_booking
JWT_SECRET=unibook-super-secret-key-change-in-production-min-256-bits
REDIS_URL=redis://localhost:6379
IAM_SERVICE_URL=http://localhost:3001
RESOURCE_CATALOGUE_URL=http://localhost:3003
APPROVAL_WORKFLOW_URL=http://localhost:3004
ANALYTICS_SERVICE_URL=http://localhost:3006
FRONTEND_URL=http://localhost:5173
```

**Resource Catalogue** (`unibook-resource-catalogue/.env`):
```env
PORT=3003
NODE_ENV=development
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_resource
BOOKING_ENGINE_DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_booking
REDIS_URL=redis://localhost:6379
JWT_SECRET=unibook-super-secret-key-change-in-production-min-256-bits
FRONTEND_URL=http://localhost:5173
REDIS_AVAILABILITY_TTL=30
REDIS_RESOURCE_TTL=300
SEARCH_MAX_RESULTS=50
CALENDAR_DAYS=30
RATE_LIMIT_MAX=200
```

**Approval Workflow** (`unibook-approval-workflow/.env`):
```env
PORT=3004
NODE_ENV=development
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_approval
BOOKING_ENGINE_DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_booking
JWT_SECRET=unibook-super-secret-key-change-in-production-min-256-bits
JWT_EXPIRES_IN=8h
IAM_SERVICE_URL=http://localhost:3001
BOOKING_ENGINE_URL=http://localhost:3002
RESOURCE_CATALOGUE_URL=http://localhost:3003
NOTIFICATION_SERVICE_URL=http://localhost:3005
ANALYTICS_SERVICE_URL=http://localhost:3006
FRONTEND_URL=http://localhost:5173
ESCALATION_HOURS=24
RATE_LIMIT_MAX=200
```

**Notification Service** (`unibook-notification-service/.env`):
```env
PORT=3005
NODE_ENV=development
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_notification
JWT_SECRET=unibook-super-secret-key-change-in-production-min-256-bits
JWT_EXPIRES_IN=8h
IAM_SERVICE_URL=http://localhost:3001
APPROVAL_WORKFLOW_URL=http://localhost:3004
FRONTEND_URL=http://localhost:5173
RATE_LIMIT_MAX=300
```

**Analytics Service** (`unibook-analytics-service/.env`):
```env
PORT=3006
NODE_ENV=development
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_analytics
APPROVAL_DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_approval
BOOKING_DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_booking
JWT_SECRET=unibook-super-secret-key-change-in-production-min-256-bits
JWT_EXPIRES_IN=8h
IAM_SERVICE_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
RATE_LIMIT_MAX=300
```

> ⚠️ **CRITICAL:** `JWT_SECRET` must be **identical** across all six backends.

### Step 5 — Run the bootstrap script

After completing Steps 1–4:
```bash
chmod +x setup.sh
./setup.sh
```

This will:
- Verify PostgreSQL, Redis, databases, and .env files
- Install all npm dependencies
- Apply all database schemas (migrations)
- Backfill analytics from existing booking data

### Step 6 — Start all services

Open **7 terminals**:

```bash
# Terminal 1
cd unibook-iam-backend && npm run dev

# Terminal 2
cd unibook-booking-engine && npm run dev

# Terminal 3
cd unibook-resource-catalogue && npm run dev

# Terminal 4
cd unibook-approval-workflow && npm run dev

# Terminal 5
cd unibook-notification-service && npm run dev

# Terminal 6
cd unibook-analytics-service && npm run dev

# Terminal 7
cd SE-A3 && npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Ports

| Service                  | Port |
|--------------------------|------|
| IAM Backend              | 3001 |
| Booking Engine           | 3002 |
| Resource Catalogue       | 3003 |
| Approval Workflow        | 3004 |
| Notification Service     | 3005 |
| Analytics & Reporting    | 3006 |
| Frontend                 | 5173 |
| Redis                    | 6379 |
| PostgreSQL               | 5432 |

---

## Analytics Service — API Reference (Subsystem 6)

All routes require an `ADMIN` JWT except the internal webhook.

| Method | Route                         | Auth             | Description                        |
|--------|-------------------------------|------------------|------------------------------------|
| GET    | `/analytics/heatmap`          | JWT (ADMIN only) | Utilisation heatmap by hour/day    |
| GET    | `/analytics/summary`          | JWT (ADMIN only) | Booking counts per event type      |
| GET    | `/analytics/export.csv`       | JWT (ADMIN only) | CSV export of raw analytics events |
| POST   | `/analytics/internal/event`   | X-Service-Key    | Internal webhook from services     |
| GET    | `/health`                     | None             | Health check                       |

Query params for heatmap, summary, export: `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `department?`, `resourceId?`

### Analytics Backfill

If the analytics dashboard shows 0 after setup (existing data before analytics was wired):
```bash
cd unibook-analytics-service
npm run db:backfill
```

This reads from the approval and booking databases and populates `analytics_events` and `utilisation_snapshots` idempotently (safe to run multiple times).

---

## Departments

When signing up, users select from:
`CSE`, `CSD`, `ECE`, `ECD`, `CLD`, `CND`, `CSAM`, `Civil`, `Mtech`, `PhD`, `Others`

Users who don't select a department are grouped under **Others** in analytics filters.

---

## Running Tests

```bash
cd unibook-iam-backend && npm test

cd unibook-booking-engine && npm test        # 56 tests, no DB needed
npm test -- --testPathPattern=nfr/nfr1-performance 2>&1 | grep -E "✓|PASS|FAIL|Tests:"     #NFR- tests


cd unibook-resource-catalogue && npm test    # 52 tests, no DB needed

cd unibook-approval-workflow && npm test     # 48 tests, no DB needed

cd unibook-notification-service && npm test  # no DB needed

cd unibook-analytics-service && npm test     # 40 tests, no DB needed
```

---

## Troubleshooting

**Migration fails with "column does not exist"**

The analytics DB has a stale partial schema. Drop and recreate it:
```bash
sudo -i -u postgres psql -c "DROP DATABASE unibook_analytics;"
sudo -i -u postgres psql -c "CREATE DATABASE unibook_analytics OWNER unibook;"
sudo -i -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE unibook_analytics TO unibook;"
cd unibook-analytics-service && npm run db:migrate && npm run db:backfill
```

**Heatmap shows no data after approving bookings**

The analytics service needs to be running when approvals happen (it receives webhooks). For historical data:
```bash
cd unibook-analytics-service && npm run db:backfill
```

**JWT errors across services**

Ensure `JWT_SECRET` is identical in all six backend `.env` files.

---

## Shared Configuration

| Config                  | IAM    | Booking | Resource | Approval | Notification | Analytics | Must Match? |
|-------------------------|--------|---------|----------|----------|--------------|-----------|-------------|
| `JWT_SECRET`            | ✅     | ✅      | ✅       | ✅       | ✅           | ✅        | ✅ YES      |
| `DATABASE_URL`          | unibook | unibook_booking | unibook_resource | unibook_approval | unibook_notification | unibook_analytics | ❌ No |
| `PORT`                  | 3001   | 3002    | 3003     | 3004     | 3005         | 3006      | ❌ No       |
| `REDIS_URL`             | —      | ✅      | ✅       | —        | —            | —         | ❌ No       |
