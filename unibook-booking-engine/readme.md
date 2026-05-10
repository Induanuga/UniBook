## Setup

### PostgreSQL (run once)
    sudo -i -u postgres
    psql
```sql
CREATE USER  WITH PASSWORD '';
CREATE DATABASE unibook_booking OWNER ;
GRANT ALL PRIVILEGES ON DATABASE unibook_booking TO ;
\q
```

## Environment
    cp .env.example .env
Edit .env and set:
 1. JWT_SECRET — must match the value in unibook-iam-backend/.env exactly
 2. DATABASE_URL — must point to your running PostgreSQL instance
   e.g. postgresql://unibook:yourpassword@localhost:5432/unibook_booking

### Run
    npm install
    npm run db:migrate
    npm run dev       # starts on :3002

### Test
    npm test          # 56 tests, no DB needed
