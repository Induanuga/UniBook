#!/bin/bash
# =============================================================================
# UniBook — Project Bootstrap Script
# Run this from the UniBook/ root folder after:
#   1. Installing PostgreSQL and Redis
#   2. Creating databases and user (see README.md Step 3)
#   3. Creating all .env files (see README.md Step 4)
# =============================================================================

set -e  # Stop on any error

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step()  { echo -e "\n${BLUE}▶ $1${NC}"; }
print_ok()    { echo -e "${GREEN}✓ $1${NC}"; }
print_warn()  { echo -e "${YELLOW}⚠ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════╗"
echo "║        UniBook — Bootstrap Setup         ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# =============================================================================
# 1. Check PostgreSQL
# =============================================================================
print_step "Checking PostgreSQL..."

if ! command -v psql &> /dev/null; then
  print_error "PostgreSQL is not installed."
  echo "  Run: sudo apt install postgresql postgresql-contrib -y"
  exit 1
fi
print_ok "PostgreSQL is installed: $(psql --version)"

if ! sudo systemctl is-active --quiet postgresql; then
  print_warn "PostgreSQL is not running. Starting it..."
  sudo systemctl start postgresql
  print_ok "PostgreSQL started."
else
  print_ok "PostgreSQL is running."
fi

# =============================================================================
# 2. Check Redis
# =============================================================================
print_step "Checking Redis..."

if ! command -v redis-cli &> /dev/null; then
  print_error "Redis is not installed. Redis is REQUIRED for Resource Catalogue caching."
  echo "  Run: sudo apt install redis-server -y"
  exit 1
fi
print_ok "Redis is installed: $(redis-cli --version)"

if ! sudo systemctl is-active --quiet redis-server; then
  print_warn "Redis is not running. Starting it..."
  sudo systemctl start redis-server
  print_ok "Redis started."
else
  print_ok "Redis is running."
fi

if ! redis-cli ping | grep -q "PONG"; then
  print_error "Redis is not responding to ping. Check Redis service."
  exit 1
fi
print_ok "Redis is responsive."

# =============================================================================
# 3. Check databases exist
# =============================================================================
print_step "Checking databases..."

check_db() {
  local DBNAME=$1
  if sudo -i -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DBNAME"; then
    print_ok "Database '$DBNAME' exists."
    return 0
  else
    print_error "Database '$DBNAME' does not exist."
    echo "  Please run the SQL commands in README.md Step 3 first."
    return 1
  fi
}

DB_OK=true
check_db "unibook"               || DB_OK=false
check_db "unibook_booking"       || DB_OK=false
check_db "unibook_resource"      || DB_OK=false
check_db "unibook_approval"      || DB_OK=false
check_db "unibook_notification"  || DB_OK=false
check_db "unibook_analytics"     || DB_OK=false

if [ "$DB_OK" = false ]; then
  echo ""
  print_error "One or more databases are missing. Please create them first:"
  echo ""
  echo "  sudo -i -u postgres psql"
  echo "  CREATE USER unibook WITH PASSWORD 'unibook123';"
  echo "  CREATE DATABASE unibook OWNER unibook;"
  echo "  CREATE DATABASE unibook_booking OWNER unibook;"
  echo "  CREATE DATABASE unibook_resource OWNER unibook;"
  echo "  CREATE DATABASE unibook_approval OWNER unibook;"
  echo "  CREATE DATABASE unibook_notification OWNER unibook;"
  echo "  CREATE DATABASE unibook_analytics OWNER unibook;"
  echo "  GRANT ALL PRIVILEGES ON DATABASE unibook TO unibook;"
  echo "  GRANT ALL PRIVILEGES ON DATABASE unibook_booking TO unibook;"
  echo "  GRANT ALL PRIVILEGES ON DATABASE unibook_resource TO unibook;"
  echo "  GRANT ALL PRIVILEGES ON DATABASE unibook_approval TO unibook;"
  echo "  GRANT ALL PRIVILEGES ON DATABASE unibook_notification TO unibook;"
  echo "  GRANT ALL PRIVILEGES ON DATABASE unibook_analytics TO unibook;"
  echo "  \q"
  echo ""
  exit 1
fi

# =============================================================================
# 4. Check .env files
# =============================================================================
print_step "Checking .env files..."

check_env() {
  local DIR=$1
  local NAME=$2
  if [ -f "$DIR/.env" ]; then
    print_ok "$NAME .env found."
  else
    print_error "$NAME .env missing at $DIR/.env"
    echo "  Copy $DIR/.env.example to $DIR/.env and fill in the values."
    exit 1
  fi
}

check_env "unibook-iam-backend"          "IAM Backend"
check_env "unibook-booking-engine"       "Booking Engine"
check_env "unibook-resource-catalogue"   "Resource Catalogue"
check_env "unibook-approval-workflow"    "Approval Workflow"
check_env "unibook-notification-service" "Notification Service"
check_env "unibook-analytics-service"    "Analytics Service"
check_env "SE-A3"                        "Frontend"

# Check JWT_SECRET matches across all backends
IAM_SECRET=$(grep '^JWT_SECRET=' unibook-iam-backend/.env | cut -d '=' -f2- | tr -d ' ')
BOOKING_SECRET=$(grep '^JWT_SECRET=' unibook-booking-engine/.env | cut -d '=' -f2- | tr -d ' ')
RESOURCE_SECRET=$(grep '^JWT_SECRET=' unibook-resource-catalogue/.env | cut -d '=' -f2- | tr -d ' ')
APPROVAL_SECRET=$(grep '^JWT_SECRET=' unibook-approval-workflow/.env | cut -d '=' -f2- | tr -d ' ')
NOTIF_SECRET=$(grep '^JWT_SECRET=' unibook-notification-service/.env | cut -d '=' -f2- | tr -d ' ')
ANALYTICS_SECRET=$(grep '^JWT_SECRET=' unibook-analytics-service/.env | cut -d '=' -f2- | tr -d ' ')

if [ "$IAM_SECRET" = "$BOOKING_SECRET" ] && \
   [ "$BOOKING_SECRET" = "$RESOURCE_SECRET" ] && \
   [ "$RESOURCE_SECRET" = "$APPROVAL_SECRET" ] && \
   [ "$APPROVAL_SECRET" = "$NOTIF_SECRET" ] && \
   [ "$NOTIF_SECRET" = "$ANALYTICS_SECRET" ]; then
  print_ok "JWT_SECRET matches across all six backends."
else
  print_error "JWT_SECRET does not match between backends!"
  echo "  All .env files must have the same JWT_SECRET value."
  exit 1
fi

# =============================================================================
# 5. Apply IAM database schema
# =============================================================================
print_step "Applying IAM database schema..."

if [ -f "unibook-iam-backend/src/db/schema.sql" ]; then
  DB_URL=$(grep DATABASE_URL unibook-iam-backend/.env | cut -d '=' -f2 | tr -d ' ')
  DB_USER=$(echo $DB_URL | sed 's/postgresql:\/\/\([^:]*\):.*/\1/')
  DB_PASS=$(echo $DB_URL | sed 's/postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/')
  DB_HOST=$(echo $DB_URL | sed 's/.*@\([^:]*\):.*/\1/')
  DB_PORT=$(echo $DB_URL | sed 's/.*:\([0-9]*\)\/.*/\1/')
  DB_NAME=$(echo $DB_URL | sed 's/.*\/\([^?]*\).*/\1/')
  PGPASSWORD=$DB_PASS psql -U $DB_USER -h $DB_HOST -p $DB_PORT -d $DB_NAME \
    -f unibook-iam-backend/src/db/schema.sql -q 2>&1 | grep -v "already exists" || true
  print_ok "IAM schema applied."
else
  print_warn "No schema.sql found for IAM backend — skipping."
fi

# =============================================================================
# 6. Install dependencies
# =============================================================================
print_step "Installing IAM Backend dependencies..."
cd unibook-iam-backend && npm install --silent && cd ..
print_ok "IAM Backend dependencies installed."

print_step "Installing Booking Engine dependencies..."
cd unibook-booking-engine && npm install --silent && cd ..
print_ok "Booking Engine dependencies installed."

print_step "Installing Resource Catalogue dependencies..."
cd unibook-resource-catalogue && npm install --silent && cd ..
print_ok "Resource Catalogue dependencies installed."

print_step "Installing Approval Workflow dependencies..."
cd unibook-approval-workflow && npm install --silent && cd ..
print_ok "Approval Workflow dependencies installed."

print_step "Installing Notification Service dependencies..."
cd unibook-notification-service && npm install --silent && cd ..
print_ok "Notification Service dependencies installed."

print_step "Installing Analytics Service dependencies..."
cd unibook-analytics-service && npm install --silent && cd ..
print_ok "Analytics Service dependencies installed."

print_step "Installing Frontend dependencies..."
cd SE-A3 && npm install --silent && cd ..
print_ok "Frontend dependencies installed."

# =============================================================================
# 7. Run database migrations
# =============================================================================
print_step "Running Booking Engine database migration..."
cd unibook-booking-engine && npm run db:migrate && cd ..
print_ok "Booking Engine schema applied."

print_step "Running Resource Catalogue database migration..."
cd unibook-resource-catalogue && npm run db:migrate && cd ..
print_ok "Resource Catalogue schema applied."

print_step "Running Approval Workflow database migration..."
cd unibook-approval-workflow && npm run db:migrate && cd ..
print_ok "Approval Workflow schema applied."

print_step "Running Notification Service database migration..."
cd unibook-notification-service && npm run db:migrate && cd ..
print_ok "Notification Service schema applied."

print_step "Running Analytics Service database migration..."
cd unibook-analytics-service && npm run db:migrate && cd ..
print_ok "Analytics Service schema applied."

# =============================================================================
# 8. Backfill analytics from existing data
# =============================================================================
print_step "Backfilling analytics from existing approval/booking data..."
cd unibook-analytics-service && npm run db:backfill && cd ..
print_ok "Analytics backfill complete."

# =============================================================================
# Done!
# =============================================================================
echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║           Setup Complete! 🎉             ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo "Start all services in 7 separate terminals:"
echo ""
echo -e "  ${BLUE}Terminal 1 — IAM Backend (port 3001):${NC}"
echo "    cd unibook-iam-backend && npm run dev"
echo ""
echo -e "  ${BLUE}Terminal 2 — Booking Engine (port 3002):${NC}"
echo "    cd unibook-booking-engine && npm run dev"
echo ""
echo -e "  ${BLUE}Terminal 3 — Resource Catalogue (port 3003):${NC}"
echo "    cd unibook-resource-catalogue && npm run dev"
echo ""
echo -e "  ${BLUE}Terminal 4 — Approval Workflow (port 3004):${NC}"
echo "    cd unibook-approval-workflow && npm run dev"
echo ""
echo -e "  ${BLUE}Terminal 5 — Notification Service (port 3005):${NC}"
echo "    cd unibook-notification-service && npm run dev"
echo ""
echo -e "  ${BLUE}Terminal 6 — Analytics Service (port 3006):${NC}"
echo "    cd unibook-analytics-service && npm run dev"
echo ""
echo -e "  ${BLUE}Terminal 7 — Frontend (port 5173):${NC}"
echo "    cd SE-A3 && npm run dev"
echo ""
echo -e "  ${GREEN}Then open: http://localhost:5173${NC}"
echo ""
echo -e "  ${YELLOW}Note: If you have existing approved/rejected bookings and the"
echo -e "  analytics dashboard shows 0, run the backfill manually:${NC}"
echo "    cd unibook-analytics-service && npm run db:backfill"
echo ""
