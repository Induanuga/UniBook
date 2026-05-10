# UniBook — Project Structure & Architecture

A **microservices-based shared resource booking system** for universities. The system implements **four core services**: **Identity & Access Management (IAM)**, **Resource Catalogue (Resource Management)**, **Booking Engine (Booking Management)**, and **Approval Workflow (Multi-Level Approvals)**.

---

## Project Overview

```
project3-se/
│
└── UniBook/
    ├── SE-A3/                      ← Frontend (React + TypeScript, port 5173)
    ├── unibook-iam-backend/        ← Service 1: Authentication & Authorization (port 3001)
    ├── unibook-resource-catalogue/ ← Service 2: Resource Management & Availability (port 3003)
    ├── unibook-booking-engine/     ← Service 3: Booking System (port 3002)
    ├── unibook-approval-workflow/  ← Service 4: Multi-Level Approvals (port 3004)
    ├── setup.sh                    ← Bootstrap script (installs all 5 services)
    ├── rEADME.md                   ← Setup instructions
    └── PROJECT_STRUCTURE.md        ← This file
```

---

## Subsystem Architecture Overview

| Service | Port | Database | Purpose |
|---------|------|----------|----------|
| IAM Backend | 3001 | `unibook` | User authentication, JWT tokens, CAS SSO, audit logs |
| Booking Engine | 3002 | `unibook_booking` | Booking submission, conflict detection, slot suggestions |
| Resource Catalogue | 3003 | `unibook_resource` | Resource discovery, availability calendar, Redis caching |
| Approval Workflow | 3004 | `unibook_approval` | Multi-level approval, escalation, alternative suggestions |
| Frontend | 5173 | N/A | React UI for all user interactions |

---

## Feature 0: Resource Catalogue Service (Resource Management)

**Purpose:** Manage university resources (rooms, labs, equipment), provide real-time availability calendars, and serve resource metadata to the Booking Engine with Redis caching for performance.

**Port:** 3003 | **Database:** `unibook_resource` (PostgreSQL) + read-only access to `unibook_booking`

### Structure

```
unibook-resource-catalogue/
│
├── package.json                    ← Dependencies: express, pg, redis, jsonwebtoken
├── jest.config.js                  ← Jest test configuration
├── tsconfig.json                   ← TypeScript config
├── .env                            ← Environment variables (PORT, DATABASE_URL, REDIS_URL, JWT_SECRET)
│
└── src/
    │
    ├── server.ts                   ← Express app initialization & route mounting
    │
    ├── config/
    │   └── index.ts                ← Config loader (reads .env, exports secrets & URLs)
    │
    ├── db/
    │   ├── index.ts                ← PostgreSQL connection pool (dual-pool: primary + booking engine read-only)
    │   ├── migrate.ts              ← Database initialization script
    │   └── schema.sql              ← SQL DDL: resources, resource_types, maintenance_windows tables
    │
    ├── types/
    │   └── index.ts                ← TypeScript interfaces
    │       ├── Resource            ← {id, name, typeId, location, capacity, amenities}
    │       ├── TimeSlot            ← {startTime, endTime, status: 'FREE'|'BOOKED'|'PENDING'|'MAINTENANCE'}
    │       ├── AvailabilityCalendar ← {resourceId, resourceName, date, slots[], cachedAt, fromCache}
    │       ├── BookingRecord       ← {id, resourceId, startTime, endTime, status}
    │       └── JWTPayload          ← {jti, sub, email, name, role, department}
    │
    ├── repositories/
    │   └── ResourceRepository.ts   ← Data access layer
    │       ├── search()            ← Find resources by filters (type, location, capacity)
    │       ├── findById()          ← Retrieve resource by ID
    │       ├── create()            ← Create new resource (admin only)
    │       ├── update()            ← Modify resource details
    │       ├── findBookingsForResource() ← Query bookings from booking_engine database
    │       ├── findMaintenanceWindows() ← Get maintenance periods
    │       └── getAvailability()   ← Calculate availability calendar
    │
    ├── services/
    │   │
    │   ├── AvailabilityCalendarService.ts ← Template Method pattern: cache→DB→build slots→populate cache
    │   │   ├── getAvailability()   ← Main entry point (15-minute slots, 96 per day)
    │   │   └── _loadFromDb()       ← Query resources + bookings + maintenance
    │   │
    │   └── ResourceSearchEngine.ts ← Specification pattern for composable filters
    │       ├── search()            ← Apply filters (type, location, capacity, amenities)
    │       └── buildSpecification() ← Compose SQL WHERE clause
    │
    ├── cache/
    │   └── AvailabilityCacheManager.ts ← Redis read-through cache (Proxy pattern)
    │       ├── getAvailability()   ← Check Redis (target: 90% hit rate)
    │       ├── setAvailability()   ← Store in Redis with 30s TTL
    │       ├── invalidateResource() ← Delete cache on maintenance changes
    │       ├── invalidateDateRange() ← Targeted invalidation for date ranges
    │       ├── buildSlots()        ← Convert bookings to [FREE|BOOKED|PENDING|MAINTENANCE] slots
    │       └── getCacheStats()     ← Metrics for health endpoint
    │
    ├── routes/
    │   └── resourceRoutes.ts       ← Express routes
    │       ├── GET    /resources   ← List resources (with filters: type, location, capacity)
    │       ├── GET    /resources/:id ← Get specific resource details
    │       ├── POST   /resources   ← Create resource (admin only)
    │       ├── PUT    /resources/:id ← Update resource (admin only)
    │       ├── GET    /resources/:id/availability ← Get 96-slot calendar
    │       ├── POST   /resources/:id/maintenance ← Schedule maintenance (admin only)
    │       ├── GET    /resource-types ← List all resource types
    │       ├── GET    /health      ← Service health check + cache stats
    │       └── GET    /search      ← Advanced resource search (alias for /resources)
    │
    ├── middleware/
    │   ├── correlationId.ts        ← Inject X-Correlation-ID header (request tracing)
    │   ├── validateToken.ts        ← JWT validation (calls IAM's shared secret)
    │   ├── roleGuard.ts            ← Role-based authorization (ADMIN-only endpoints)
    │   └── errorHandler.ts         ← Centralized error response formatting
    │
    ├── events/
    │   └── BookingEventListener.ts ← Webhook listener (Proxy pattern for cross-service communication)
    │       ├── onBookingSubmitted() ← Invalidate availability cache
    │       ├── onBookingApproved() ← Update cache with approved booking
    │       └── onBookingCancelled() ← Invalidate affected time slots
    │
    ├── utils/
    │   ├── logger.ts               ← Structured logging (JSON format)
    │   └── validators.ts           ← Input validation helpers
    │
    └── __tests__/                  ← Unit tests (Jest)
        ├── resourceRoutes.test.ts  ← HTTP endpoint tests
        ├── resourceSearch.test.ts  ← Search filter tests
        ├── availabilityCalendar.test.ts ← Calendar generation tests
        ├── cacheManager.test.ts    ← Redis cache tests
        ├── bookingIntegration.test.ts ← Cross-database query tests
        └── healthCheck.test.ts     ← Health endpoint tests
```

### Key Files Summary

| File | Responsibility |
|------|-----------------|
| `services/AvailabilityCalendarService.ts` | Template Method: retrieve data, build calendar, cache result |
| `cache/AvailabilityCacheManager.ts` | Redis proxy: 20ms cache hits vs 80ms DB misses |
| `repositories/ResourceRepository.ts` | Dual-database access: primary resources + read-only booking queries |
| `routes/resourceRoutes.ts` | REST endpoints: resources, availability, maintenance scheduling |
| `events/BookingEventListener.ts` | Listen for booking changes to invalidate cache |
| `db/schema.sql` | Resource tables with indexes for performance |

### Architecture Highlights

**Dual-Database Architecture:**
- **Primary (unibook_resource):** Resources, resource types, maintenance windows (read/write)
- **Read-Only (unibook_booking):** Bookings table from Booking Engine (availability calculation)
- **Separation:** No cross-table JOINs; clean service boundaries

**Caching Strategy (ADR-002):**
- **Layer 1:** Redis read-through cache (30s TTL for availability, 300s for metadata)
- **Layer 2:** PostgreSQL (fallback on cache miss)
- **Invalidation:** Selective invalidation on booking/maintenance events (not full flush)
- **Performance Target:** >= 90% hit rate at peak hours

**Design Patterns Used:**
- **Template Method:** AvailabilityCalendarService (skeleton: cache→DB→build→cache)
- **Specification:** ResourceSearchEngine (composable filter logic)
- **Proxy:** AvailabilityCacheManager (transparent Redis interception)
- **Observer:** BookingEventListener (event-driven cache invalidation)
- **Singleton:** Database pools (shared connection management)

---

## Feature 1: Authentication Service (IAM Backend)

**Purpose:** Handle user identity, access management, JWT token issuance, and CAS SSO integration.

**Port:** 3001 | **Database:** `unibook` (PostgreSQL)

### Structure

```
unibook-iam-backend/
│
├── package.json                    ← Dependencies: express, jsonwebtoken, bcryptjs, axios, xml2js
├── tsconfig.json                   ← TypeScript config
├── .env                            ← Environment variables (JWT_SECRET, DATABASE_URL, CAS settings)
│
└── src/
    │
    ├── server.ts                   ← Express app initialization & route mounting
    │
    ├── db.ts                       ← PostgreSQL connection pool setup
    │
    ├── config/
    │   └── index.ts                ← Config loader (reads .env, exports secrets & URLs)
    │
    ├── db/
    │   └── schema.sql              ← SQL DDL: users table, indexes, constraints
    │
    ├── models/
    │   └── userModel.ts            ← User entity interface & database queries
    │
    ├── controllers/
    │   ├── authController.ts       ← HTTP request handlers
    │   │   ├── signup()            ← Register new user (email/password)
    │   │   ├── login()             ← Authenticate user, return JWT pair
    │   │   ├── refresh()           ← Issue new accessToken from refreshToken
    │   │   └── logout()            ← Blacklist tokens by jti
    │   │
    │   └── casController.ts        ← CAS SSO handlers
    │       ├── initiateLogin()     ← Redirect to CAS server
    │       └── callback()          ← Parse CAS ticket, create/sync user, return JWT
    │
    ├── services/
    │   ├── jwtIssuer.ts            ← Token generation (access + refresh pair)
    │   │   ├── issueTokens()       ← Create JWT pair with unique jti per token
    │   │   └── verifyToken()       ← Decode & validate JWT signature
    │   │
    │   ├── casService.ts           ← CAS protocol integration
    │   │   ├── validateTicket()    ← Call CAS server to verify ticket
    │   │   └── parseXmlResponse()  ← Extract username from CAS XML response
    │   │
    │   ├── tokenBlacklist.ts       ← Token revocation on logout
    │   │   ├── addToBlacklist()    ← Store jti in blacklist (in-memory or Redis)
    │   │   └── isBlacklisted()     ← Check if jti is revoked
    │   │
    │   └── auditLogger.ts          ← Security audit trail
    │       └── log()               ← Record auth events (login, logout, failures)
    │
    ├── routes/
    │   ├── authRoutes.ts           ← POST /auth/signup, /auth/login, /auth/refresh, /auth/logout
    │   └── casRoutes.ts            ← GET /auth/cas/login, /auth/cas/callback
    │
    ├── middleware/
    │   ├── correlationId.ts        ← Inject X-Correlation-ID header (request tracing)
    │   ├── jwtValidator.ts         ← Verify JWT in Authorization header
    │   │   ├── Extract token
    │   │   ├── Decode & verify signature
    │   │   └── Check blacklist
    │   │
    │   └── roleGuard.ts            ← Role-based access control (RBAC)
    │       └── checkRole()         ← Enforce role requirements (ADMIN, FACULTY, STUDENT, etc.)
    │
    └── types/
        └── index.ts                ← TypeScript interfaces
            ├── JWTPayload          ← {jti, sub, email, name, role, department}
            ├── User                ← {id, email, password, name, role, department, createdAt}
            └── AuthResponse        ← {accessToken, refreshToken, user}
```

### Key Files Summary

| File | Responsibility |
|------|-----------------|
| `controllers/authController.ts` | Login, signup, token refresh, logout endpoints |
| `services/jwtIssuer.ts` | Generate JWT access & refresh tokens with unique `jti` |
| `services/casService.ts` | CAS SSO protocol: validate tickets, sync users |
| `services/tokenBlacklist.ts` | Revoke tokens on logout by storing `jti` |
| `middleware/jwtValidator.ts` | Extract, decode, and validate JWT in requests |
| `db/schema.sql` | Users table with password hashing & timestamps |

---

## Feature 2: Booking System Service (Booking Engine)

**Purpose:** Handle resource booking requests, conflict detection, availability suggestions, and booking policies.

**Port:** 3002 | **Database:** `unibook_booking` (PostgreSQL)

### Structure

```
unibook-booking-engine/
│
├── jest.config.js                 ← Jest test configuration
├── package.json                   ← Dependencies: express, pg, jsonwebtoken, uuid
├── tsconfig.json                  ← TypeScript config
├── .env                           ← Environment variables (PORT, DATABASE_URL, JWT_SECRET)
│
└── src/
    │
    ├── server.ts                  ← Express app with middleware stack & route setup
    │
    ├── config/
    │   └── index.ts               ← Config loader (reads .env, exports DB URL, JWT secret)
    │
    ├── db/
    │   ├── index.ts               ← PostgreSQL connection pool
    │   ├── migrate.ts             ← Database initialization script
    │   └── schema.sql             ← SQL DDL: bookings, resources, audit tables
    │
    ├── types/
    │   └── index.ts               ← TypeScript interfaces
    │       ├── BookingRequest      ← {resourceId, startTime, endTime, purpose, attendeeCount}
    │       ├── BookingResult       ← {success, booking, conflict?, suggestions?}
    │       ├── Booking             ← {id, resourceId, userId, startTime, endTime, status, ...}
    │       └── JWTPayload          ← {jti, sub, email, role, ...}
    │
    ├── repositories/
    │   └── BookingRepository.ts    ← Data access layer
    │       ├── insert()            ← Create new booking (DB INSERT)
    │       ├── findById()          ← Retrieve booking by ID
    │       ├── findByUserId()      ← Get all bookings for a user
    │       ├── findByResource()    ← Get all bookings for a resource
    │       ├── update()            ← Modify booking status
    │       └── delete()            ← Cancel booking
    │
    ├── policies/
    │   ├── IBookingPolicy.ts       ← Interface (Strategy pattern)
    │   │   └── canBook()           ← Abstract method
    │   │
    │   ├── BookingPolicyRegistry.ts ← Policy factory & registry
    │   │   ├── register()          ← Register policy for role
    │   │   └── getPolicy()         ← Retrieve policy by role
    │   │
    │   ├── FIFOPolicy.ts           ← First-In-First-Out booking policy
    │   │   └── canBook()           ← Check if user can book (simple check)
    │   │
    │   ├── PriorityPolicy.ts       ← Priority-based booking (role hierarchy)
    │   │   └── canBook()           ← Higher roles get priority
    │   │
    │   └── QuotaPolicy.ts          ← Quota enforcement (bookings per user/period)
    │       └── canBook()           ← Check quota limits
    │
    ├── services/
    │   │
    │   ├── BookingFacade.ts        ← HTTP handler layer
    │   │   ├── submitBooking()     ← POST endpoint handler
    │   │   ├── getMyBookings()     ← GET endpoint handler
    │   │   └── cancelBooking()     ← DELETE endpoint handler
    │   │
    │   ├── BookingService.ts       ← Core booking transaction logic
    │   │   ├── submitBooking()     ← Orchestrate: policy → conflict check → DB insert
    │   │   │   Step 1: Policy validation
    │   │   │   Step 2: Open DB transaction
    │   │   │   Step 3: Run conflict detection
    │   │   │   Step 4: Insert if clear OR suggest slots if conflict
    │   │   │   Step 5: Commit/rollback
    │   │   │   Step 6: Emit BookingSubmitted event
    │   │   │
    │   │   └── getMyBookings()     ← Retrieve user's bookings
    │   │
    │   ├── ConflictDetectionEngine.ts ← Check time overlaps (SELECT FOR UPDATE)
    │   │   ├── check()             ← Query overlapping bookings with lock
    │   │   └── hasConflict()       ← Boolean result
    │   │
    │   ├── SlotSuggestionService.ts ← Recommend available time slots
    │   │   ├── findNextAvailable() ← Search for free slots after conflict
    │   │   ├── getSuggestions()    ← Return list of suggested slots
    │   │   └── queryAvailableSlots() ← Query DB for gaps in schedule
    │   │
    │   └── IdempotencyGuard.ts     ← Duplicate request prevention
    │       ├── generateKey()       ← Hash request data
    │       ├── recordRequest()     ← Store request result
    │       └── getResult()         ← Return cached result if duplicate
    │
    ├── repositories/
    │   └── BookingRepository.ts    ← Database operations (already listed above)
    │
    ├── routes/
    │   └── bookingRoutes.ts        ← Express routes
    │       ├── POST   /bookings    ← Submit booking (BookingFacade.submitBooking)
    │       ├── GET    /bookings    ← Get user's bookings
    │       ├── GET    /bookings/:id ← Get specific booking
    │       ├── PUT    /bookings/:id ← Update booking status
    │       ├── DELETE /bookings/:id ← Cancel booking
    │       └── GET    /resources/:id/suggestions ← Get slot suggestions
    │
    ├── middleware/
    │   ├── correlationId.ts        ← Inject X-Correlation-ID header (request tracing)
    │   │   └── middleware()        ← Add UUID to all requests
    │   │
    │   ├── validateToken.ts        ← JWT validation (calls IAM's public key)
    │   │   ├── Extract token
    │   │   ├── Verify signature
    │   │   ├── Check expiration
    │   │   └── Attach user to request
    │   │
    │   └── roleGuard.ts            ← Role-based authorization
    │       └── requireRole()       ← Enforce required roles
    │
    ├── events/
    │   └── EventBus.ts             ← Pub-Sub for loose coupling (Observer pattern)
    │       ├── on()                ← Register event listener
    │       ├── emit()              ← Publish event
    │       ├── Events:
    │       │   ├── 'BookingSubmitted'
    │       │   ├── 'BookingApproved'
    │       │   ├── 'BookingRejected'
    │       │   └── 'BookingCancelled'
    │       │
    │       └── Decouples from: Analytics, Notifications, Audit systems
    │
    ├── utils/
    │   └── logger.ts               ← Structured logging
    │       ├── info()              ← Log info events
    │       ├── error()             ← Log errors with stack trace
    │       └── debug()             ← Debug logs
    │
    └── __tests__/                  ← Unit tests (Jest)
        ├── bookingRoutes.test.ts   ← HTTP endpoint tests
        ├── bookingService.test.ts  ← Business logic tests
        ├── conflictDetection.test.ts ← Overlap detection tests
        ├── eventBus.test.ts        ← Event bus tests
        ├── idempotencyGuard.test.ts ← Duplicate prevention tests
        ├── policies.test.ts        ← Policy strategy tests
        └── slotSuggestion.test.ts  ← Suggestion engine tests
```

### Key Files Summary

| File | Responsibility |
|------|-----------------|
| `services/BookingService.ts` | Core transaction logic: policy → conflict check → insert → emit event |
| `services/ConflictDetectionEngine.ts` | Detect time overlaps using database locks |
| `services/SlotSuggestionService.ts` | Find available time slots after conflicts |
| `policies/BookingPolicyRegistry.ts` | Strategy pattern: route requests to correct policy |
| `routes/bookingRoutes.ts` | REST endpoints for booking operations |
| `db/schema.sql` | Bookings, resources, and audit tables |
| `__tests__/` | Comprehensive unit tests with Jest |

---

## Feature 3: Approval Workflow Service (Multi-Level Approvals)

**Purpose:** Handle multi-level approval for booking requests, auto-escalation after timeout, and alternative slot suggestions by admin.

**Port:** 3004 | **Database:** `unibook_approval` (PostgreSQL)

### Structure

```
unibook-approval-workflow/
│
├── jest.config.js                 ← Jest test configuration
├── package.json                   ← Dependencies: express, pg, jsonwebtoken, node-cron
├── tsconfig.json                  ← TypeScript config
├── .env                           ← Environment variables (PORT, DATABASE_URL, JWT_SECRET, ESCALATION_HOURS)
│
└── src/
    │
    ├── server.ts                  ← Express app initialization & route mounting
    │
    ├── config/
    │   └── index.ts               ← Config loader (escalation hours, check intervals)
    │
    ├── db/
    │   ├── index.ts               ← PostgreSQL connection pool
    │   ├── migrate.ts             ← Database initialization script
    │   └── schema.sql             ← SQL DDL: approval_requests, approver_assignments tables
    │
    ├── types/
    │   └── index.ts               ← TypeScript interfaces
    │       ├── ApprovalRequest    ← {id, bookingId, userId, status, alternativeSlot?, decision?, decidedBy?}
    │       ├── ApprovalStatus     ← 'AWAITING_FACULTY' | 'AWAITING_ADMIN' | 'APPROVED' | 'REJECTED' | 'ALTERNATIVE_SUGGESTED'
    │       ├── ApprovalDecision   ← {decision, alternativeSlot?, comments?, decidedAt}
    │       └── ApproverAssignment ← {approvalId, approverId, approverRole, status}
    │
    ├── repositories/
    │   └── ApprovalRepository.ts  ← Data access layer
    │       ├── createApproval()   ← Create new approval request
    │       ├── findById()         ← Retrieve approval by ID
    │       ├── getPending()       ← Get pending approvals (AWAITING_FACULTY/ADMIN)
    │       ├── recordDecision()   ← Store approval decision
    │       ├── getByBookingId()   ← Get approval for specific booking
    │       ├── findPendingEscalation() ← Find approvals past timeout
    │       └── updateStatus()     ← Update approval status
    │
    ├── services/
    │   │
    │   ├── ApprovalService.ts     ← Core approval logic
    │   │   ├── submitApproval()   ← Create approval from booking event
    │   │   ├── getPending()       ← Fetch pending approvals for current user
    │   │   ├── submitDecision()   ← Record faculty/admin decision
    │   │   ├── suggestAlternative() ← Admin suggests alternative slot
    │   │   ├── getApprovalForBooking() ← Retrieve approval status for booking
    │   │   └── getMyApprovals()   ← Get approval history for current user
    │   │
    │   └── EscalationScheduler.ts ← Background job (Chain of Responsibility)
    │       ├── start()            ← Begin scheduler (configurable interval)
    │       ├── stop()             ← Stop scheduler
    │       ├── check()            ← Find & escalate timed-out approvals
    │       └── escalate()         ← Move AWAITING_FACULTY → AWAITING_ADMIN
    │
    ├── handlers/
    │   ├── IApprovalHandler.ts    ← Handler interface (Chain of Responsibility)
    │   │   ├── handle()           ← Process approval
    │   │   └── setNext()          ← Link to next handler
    │   │
    │   ├── AbstractApprovalHandler.ts ← Base class for handlers
    │   │
    │   ├── ApprovalHandlerChain.ts ← Chain composition (Faculty → Admin → Complete)
    │   │   └── execute()          ← Execute chain of responsibility
    │   │
    │   ├── FacultyApprovalHandler.ts ← Handle faculty-level decisions
    │   │   └── handle()           ← Check if faculty can approve
    │   │
    │   ├── AdminApprovalHandler.ts ← Handle admin-level decisions
    │   │   └── handle()           ← Check if admin can approve
    │   │
    │   └── EscalationHandler.ts   ← Auto-escalation handler
    │       └── handle()           ← Escalate if timeout reached
    │
    ├── routes/
    │   └── approvalRoutes.ts      ← Express routes
    │       ├── GET    /approvals/pending ← Get pending approvals (faculty/admin only)
    │       ├── GET    /approvals/my ← Get user's submitted approvals
    │       ├── GET    /approvals/booking/:id ← Get approval status for booking
    │       ├── POST   /approvals/:id/decide ← Submit decision (approve/reject/suggest)
    │       └── GET    /health     ← Health check
    │
    ├── middleware/
    │   ├── correlationId.ts       ← Inject X-Correlation-ID header (request tracing)
    │   ├── validateToken.ts       ← JWT validation (calls IAM's shared secret)
    │   └── roleGuard.ts           ← Role-based authorization (FACULTY/ADMIN-only)
    │
    ├── events/
    │   └── EventListener.ts       ← Webhook listener for booking events
    │       ├── onBookingSubmitted() ← Create approval request
    │       └── onBookingApproved() ← Verify approval exists
    │
    ├── utils/
    │   └── logger.ts              ← Structured logging (JSON format)
    │
    └── __tests__/                 ← Unit tests (Jest)
        ├── approvalRepository.test.ts ← Data layer tests
        ├── approvalService.test.ts ← Business logic tests
        ├── approvalRoutes.test.ts ← HTTP endpoint tests
        ├── escalationScheduler.test.ts ← Scheduler tests
        └── handlerChain.test.ts   ← Chain of Responsibility tests
```

### Key Files Summary

| File | Responsibility |
|------|-----------------|
| `services/ApprovalService.ts` | Core approval logic: submit, decide, escalate |
| `services/EscalationScheduler.ts` | Background job: check timed-out approvals, auto-escalate |
| `handlers/ApprovalHandlerChain.ts` | Chain of Responsibility: Faculty → Admin → Complete |
| `repositories/ApprovalRepository.ts` | Data access: approvals, assignments, decisions |
| `routes/approvalRoutes.ts` | REST endpoints for approvals |
| `db/schema.sql` | Approval requests & assignments tables |
| `__tests__/` | 48 unit tests (no database mocking needed) |

### Approval Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Booking Engine                                             │
│  (Booking approved)                                         │
└──────────────┬──────────────────────────────────────────────┘
               │ EventBus: booking.created
               ↓
┌──────────────────────────────────────────────────────────────┐
│  Approval Workflow                                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ApprovalService.submitApproval()                    │   │
│  │  → Create ApprovalRequest (status: AWAITING_FACULTY) │   │
│  │  → Broadcast to all Faculty in department           │   │
│  │  → ApproverAssignment created for each Faculty      │   │
│  └──────────────────────────────────────────────────────┘   │
│       ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Faculty Reviews                                     │   │
│  │  (GET /approvals/pending)                            │   │
│  │                                                      │   │
│  │  Faculty Decision:                                   │   │
│  │  • APPROVE   → Booking becomes APPROVED            │   │
│  │  • REJECT    → Booking becomes REJECTED            │   │
│  │  • SUGGEST   → Offer alternative time slot         │   │
│  └──────────────────────────────────────────────────────┘   │
│       ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  EscalationScheduler (runs every 15 minutes)        │   │
│  │  • Check: AWAITING_FACULTY > ESCALATION_HOURS?     │   │
│  │  • If yes: escalate to AWAITING_ADMIN              │   │
│  │  • Notify all Admins                               │   │
│  └──────────────────────────────────────────────────────┘   │
│       ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Admin Reviews (if escalated)                        │   │
│  │  (GET /approvals/pending - admin view)              │   │
│  │                                                      │   │
│  │  Admin Decision:                                     │   │
│  │  • APPROVE   → Booking becomes APPROVED            │   │
│  │  • REJECT    → Booking becomes REJECTED            │   │
│  │  • SUGGEST   → Offer alternative time slot         │   │
│  └──────────────────────────────────────────────────────┘   │
│       ↓                                                      │
│  Approval Complete (status: APPROVED/REJECTED)             │
└──────────────────────────────────────────────────────────────┘
```

### Key Features

- **Chain of Responsibility:** Faculty approval first, auto-escalate to Admin if no response
- **Broadcast Model:** All faculty in department notified; first-one-wins
- **Scheduled Escalation:** Configurable check interval (default: 15 minutes) & escalation hours (default: 24 hours)
- **Alternative Suggestions:** Admin can propose alternative time slots with start/end times
- **Decision History:** Track who decided, when, alternative slots offered, and comments

---

## Frontend Layer

**Purpose:** React UI for users to authenticate and manage bookings.

**Port:** 5173 | **Framework:** React 19 + TypeScript + Vite

### Structure

```
SE-A3/
│
├── package.json                   ← Dependencies: react, react-dom, Vite, ESLint
├── tsconfig.json                  ← TypeScript configuration
├── vite.config.ts                 ← Vite bundler config
├── index.html                     ← HTML entry point
│
└── src/
    │
    ├── main.tsx                   ← React app root (mount to #app)
    ├── App.tsx                    ← Main app component with routing
    ├── App.css                    ← Global styles
    ├── index.css                  ← Base styles
    │
    ├── types/
    │   └── auth.ts                ← TypeScript interfaces
    │       ├── User               ← {id, email, name, role, department}
    │       ├── LoginCredentials   ← {email, password}
    │       ├── LoginResponse      ← {accessToken, refreshToken, user}
    │       └── BookingStatus      ← 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
    │
    ├── services/
    │   ├── authService.ts         ← API calls to IAM (port 3001)
    │   │   ├── login()            ← POST /auth/login
    │   │   ├── signup()           ← POST /auth/signup
    │   │   ├── refreshToken()     ← POST /auth/refresh
    │   │   ├── logout()           ← POST /auth/logout
    │   │   └── initiateSSO()      ← GET /auth/cas/login (CAS redirect)
    │   │
    │   └── bookingService.ts      ← API calls to Booking Engine (port 3002)
    │       ├── submitBooking()    ← POST /bookings
    │       ├── getMyBookings()    ← GET /bookings
    │       ├── cancelBooking()    ← DELETE /bookings/:id
    │       └── getSuggestions()   ← GET /resources/:id/suggestions
    │
    ├── context/
    │   └── AuthContext.tsx        ← Global auth state (React Context)
    │       ├── currentUser        ← Logged-in user data
    │       ├── accessToken        ← JWT access token
    │       ├── login()            ← Set user & token after login
    │       ├── logout()           ← Clear auth state
    │       └── refreshAccessToken() ← Request new token from server
    │
    ├── components/
    │   └── ProtectedRoute.tsx      ← Route guard (redirect if not authenticated)
    │       ├── Check if user exists
    │       └── Render or redirect to login
    │
    └── pages/
        ├── LoginPage.tsx          ← Login form (email/password)
        │   ├── Form inputs
        │   └── Call authService.login()
        │
        ├── SignupPage.tsx         ← Signup form (email, password, name, role)
        │   ├── Form inputs
        │   └── Call authService.signup()
        │
        ├── CasCallbackPage.tsx    ← CAS SSO callback handler
        │   ├── Extract ticket from URL params
        │   └── Call authService.casCallback()
        │
        ├── DashboardPage.tsx      ← User dashboard (post-login)
        │   ├── Display user info
        │   └── Navigation to booking pages
        │
        ├── MyBookingsPage.tsx     ← View user's bookings
        │   ├── Call bookingService.getMyBookings()
        │   ├── Display booking list
        │   └── Cancel booking button
        │
        └── NewBookingPage.tsx     ← Create new booking
            ├── Form: resource, start time, end time, purpose, attendee count
            ├── Submit → bookingService.submitBooking()
            └── If conflict → display suggestions
```

### Key Files Summary

| File | Responsibility |
|------|-----------------|
| `services/authService.ts` | Call IAM backend for auth operations |
| `services/bookingService.ts` | Call Booking Engine for booking operations |
| `context/AuthContext.tsx` | Centralized auth state & token management |
| `pages/LoginPage.tsx` | Email/password login form |
| `pages/CasCallbackPage.tsx` | CAS SSO callback handler |
| `pages/NewBookingPage.tsx` | Booking submission form with conflict handling |
| `components/ProtectedRoute.tsx` | Route guard for authenticated pages |

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                        │
│                   http://localhost:5173                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────┐   │
│  │ LoginPage    │  │ NewBookingPage   │  │ Dashboard   │   │
│  │              │  │ MyBookingsPage   │  │ PendingAppr.│   │
│  │ SignupPage   │  │                  │  │ MyApprStatus│   │
│  └──────────────┘  └──────────────────┘  └─────────────┘   │
│       ↓                      ↓                  ↓             │
│  authService.ts      bookingService.ts  authContext        │
│                      approvalService.ts                     │
└────────┬────────────────────┬──────────────────┬────────────┘
         │                    │                  │
         ↓                    ↓                  ↓
    ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
    │  IAM Backend   │  │  Booking     │  │  Resource    │
    │  Port 3001     │  │  Engine      │  │  Catalogue   │
    │  ┌──────────┐  │  │  Port 3002   │  │  Port 3003   │
    │  │authControl│  │  ┌──────────┐  │  │ ┌──────────┐ │
    │  │casControl │  │  │BookingFac│  │  │ │  search  │ │
    │  └──────────┘  │  │  policies │  │  │ │cache mgr│ │
    │       ↓        │  │  conflict │  │  │ └──────────┘ │
    │  ┌──────────┐  │  │EventBus   │  │  │      ↓       │
    │  │jwtIssuer │  │  │(Pub-Sub)  │  │  │  ┌──────────┐│
    │  │token     │  │  └──────────┘  │  │  │PostgreSQL││
    │  │blacklist │  │       ↓        │  │  │unibook   ││
    │  └──────────┘  │  ┌──────────┐  │  │  │_resource ││
    │       ↓        │  │PostgreSQL│  │  │  └──────────┘│
    │  ┌──────────┐  │  │unibook   │  │  │      ↓       │
    │  │PostgreSQL│  │  │_booking  │  │  │    Redis    │
    │  │unibook   │  │  └──────────┘  │  │ (cache)    │
    │  └──────────┘  │                 └──────────────────┘
    │                │
    │        EventBus.emit('BookingSubmitted')
    │                │
    │                ↓
    │         ┌─────────────────────────────────┐
    │         │  Approval Workflow              │
    │         │  Port 3004                      │
    │         │  ┌──────────────────────────┐   │
    │         │  │ApprovalService           │   │
    │         │  │EscalationScheduler       │   │
    │         │  │ApprovalHandlerChain      │   │
    │         │  │(Faculty→Admin→Complete)  │   │
    │         │  └──────────────────────────┘   │
    │         │          ↓                       │
    │         │  ┌──────────────────────────┐   │
    │         │  │PostgreSQL                │   │
    │         │  │unibook_approval          │   │
    │         │  └──────────────────────────┘   │
    │         └─────────────────────────────────┘
    │
    └────────────────────────────────────────────┐
                                                 │
    ┌────────────────────────────────────────────┘
    ├─ Email Notifications (Future)
    ├─ Audit Logging (Future)
    └─ Analytics (Future)
```

---

## Data Flow Examples

### 1. User Login Flow

```
Frontend (LoginPage)
    ↓ POST /auth/login
IAM Backend (authController.login)
    ↓ Verify credentials (bcryptjs)
IAM Service (jwtIssuer.issueTokens)
    ↓ Create JWT pair with unique jti
Frontend (store in localStorage + AuthContext)
    ↓ Set currentUser & accessToken
Redirect to Dashboard
```

### 2. Submit Booking Flow

```
Frontend (NewBookingPage) → bookingService.submitBooking()
    ↓ POST /bookings with JWT header
Booking Engine (BookingFacade.submitBooking)
    ↓ 1. Policy check (QuotaPolicy, PriorityPolicy)
    ↓ 2. Open transaction
    ↓ 3. ConflictDetectionEngine.check() → SELECT FOR UPDATE
    ├─ Conflict detected → SlotSuggestionService.findNextAvailable()
    │  ↓ Return suggestions to frontend
    │
    └─ No conflict → BookingRepository.insert()
       ↓ Commit transaction
       ↓ EventBus.emit('BookingSubmitted')
       ↓ Return booking to frontend
```

### 3. Submit Booking → Approval Workflow

```
Frontend (NewBookingPage) → bookingService.submitBooking()
    ↓ POST /bookings with JWT header
Booking Engine (BookingFacade.submitBooking)
    ↓ 1. Policy check (QuotaPolicy, PriorityPolicy)
    ↓ 2. Open transaction
    ↓ 3. ConflictDetectionEngine.check() → SELECT FOR UPDATE
    ├─ Conflict detected → SlotSuggestionService.findNextAvailable()
    │  ↓ Return suggestions to frontend
    │
    └─ No conflict → BookingRepository.insert()
       ↓ Create booking with status: PENDING
       ↓ Commit transaction
       ↓ EventBus.emit('BookingSubmitted')
           │
           ↓ EventListener in Approval Workflow
           │
    Approval Workflow (ApprovalService.submitApproval)
       ├─ Create ApprovalRequest (status: AWAITING_FACULTY)
       ├─ Broadcast to all Faculty in department
       ├─ ApprovalHandlerChain ready
       │
       ↓ Faculty Reviews (GET /approvals/pending)
       │
       Faculty Decision:
       ├─ APPROVE   → recordDecision() → Booking becomes APPROVED
       ├─ REJECT    → recordDecision() → Booking becomes REJECTED
       └─ SUGGEST   → suggestAlternative() → Offer new time slot
           │
           ↓ If no decision after ESCALATION_HOURS (default: 24h)
           │
       EscalationScheduler.check() (runs every 15 min)
           ├─ Find AWAITING_FACULTY > 24 hours old
           ├─ Escalate to AWAITING_ADMIN
           └─ Broadcast to all Admins
               │
               ↓ Admin Reviews & Decides
               │
               Admin Decision:
               ├─ APPROVE   → Booking becomes APPROVED
               ├─ REJECT    → Booking becomes REJECTED
               └─ SUGGEST   → Offer alternative slot
                   │
                   ↓ Approval Complete
                   │
    Frontend (MyApprovalStatusPage)
       └─ Student views final approval status + alternative slots
```

### 4. Logout & Token Revocation

```
Frontend (Dashboard) → logout()
    ↓ POST /auth/logout with accessToken + refreshToken
IAM Backend (authController.logout)
    ↓ Extract jti from both tokens
    ↓ Add both jti values to tokenBlacklist
    ↓ Return success
Frontend (clear localStorage + AuthContext)
    ↓ Redirect to LoginPage
```

---

## Design Patterns Used

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Strategy** | `BookingPolicyRegistry` | Different booking policies (FIFO, Priority, Quota) |
| **Observer** | `EventBus` | Decouple booking service from future systems (notifications, analytics) |
| **Facade** | `BookingFacade` | Simplify HTTP layer, delegate to services |
| **Repository** | `BookingRepository` | Abstract database operations |
| **Factory** | `BookingPolicyRegistry` | Create policies by role |
| **Middleware** | Express | JWT validation, CORS, logging, rate limiting |

---

## Security Features

- ✅ **JWT with unique `jti`** per token for blacklisting on logout
- ✅ **Role-based access control (RBAC)** via middleware
- ✅ **Bcryptjs** password hashing (IAM)
- ✅ **CAS SSO** integration for enterprise auth
- ✅ **Token expiration** (access: 8h, refresh: 7d)
- ✅ **Correlation IDs** for request tracing
- ✅ **Idempotency guards** to prevent duplicate bookings
- ✅ **Database locks** (SELECT FOR UPDATE) in conflict detection
- ✅ **Rate limiting** on sensitive endpoints

---

## Environment Configuration

### IAM Backend (`.env`)
```env
PORT=3001
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook
JWT_SECRET=unibook-super-secret-key-change-in-production
JWT_EXPIRES_IN=8h
JWT_REFRESH_SECRET=unibook-refresh-secret-key-change-in-production
JWT_REFRESH_EXPIRES_IN=7d
CAS_SERVER_URL=https://login.iiit.ac.in/cas
CAS_SERVICE_URL=http://localhost:3001/auth/cas/callback
```

### Booking Engine (`.env`)
```env
PORT=3002
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_booking
JWT_SECRET=unibook-super-secret-key-change-in-production
```

### Resource Catalogue (`.env`)
```env
PORT=3003
DATABASE_URL=postgresql://unibook:unibook123@localhost:5432/unibook_resource
JWT_SECRET=unibook-super-secret-key-change-in-production
REDIS_URL=redis://localhost:6379
```

### Approval Workflow (`.env`)
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
FRONTEND_URL=http://localhost:5173
ESCALATION_HOURS=24
RATE_LIMIT_MAX=200
```

### Frontend (`.env`)
```env
VITE_API_URL=http://localhost:3001
VITE_BOOKING_API_URL=http://localhost:3002
VITE_RESOURCE_API_URL=http://localhost:3003
VITE_APPROVAL_API_URL=http://localhost:3004
```

---

## Getting Started

```bash
# 1. Install dependencies and run migrations
cd UniBook
./setup.sh

# 2. Run all services in 5 terminals
# Terminal 1: IAM Backend
cd unibook-iam-backend && npm run dev

# Terminal 2: Booking Engine
cd unibook-booking-engine && npm run dev

# Terminal 3: Resource Catalogue
cd unibook-resource-catalogue && npm run dev

# Terminal 4: Approval Workflow
cd unibook-approval-workflow && npm run dev

# Terminal 5: Frontend
cd SE-A3 && npm run dev

# 3. Access frontend
open http://localhost:5173
```

---

## Testing

```bash
# IAM Backend tests
cd unibook-iam-backend
npm test

# Booking Engine tests
cd unibook-booking-engine
npm test                    # Run all tests
npm run test:coverage       # Coverage report

# Resource Catalogue tests
cd unibook-resource-catalogue
npm test                    # Run all tests (52 tests)
npm run test:coverage       # Coverage report

# Approval Workflow tests
cd unibook-approval-workflow
npm test                    # Run all tests (48 tests, no DB mocking)
npm run test:coverage       # Coverage report
```

---

## File Statistics

| Service | Language | Main Files | Test Files | Port |
|---------|----------|------------|------------|------|
| IAM Backend | TypeScript | 13 | 0 | 3001 |
| Booking Engine | TypeScript | 15+ | 7 | 3002 |
| Resource Catalogue | TypeScript | 16+ | 6 | 3003 |
| Approval Workflow | TypeScript | 14+ | 5 | 3004 |
| Frontend | TypeScript + React | 12 | 0 | 5173 |
| **Total** | — | **70+** | **18** | — |

