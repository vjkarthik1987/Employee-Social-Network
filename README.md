# Employee Engagement App (MVP)

An internal, ad-free, multi-tenant “Facebook for Work” built with **Node.js, Express, MongoDB, EJS-Mate, Passport (bcrypt)**.

> Goal (Day 45): Demo-ready MVP with auth, tenant feeds, posts, comments, reactions, basic moderation, per-post analytics, and production hosting.

---

## 0) Tech Stack & Conventions

- **Server:** Node.js 20+, Express 4
- **DB:** MongoDB (Atlas or self-hosted)
- **Views:** EJS + ejs-mate (layouts/partials)
- **Auth:** Passport (local strategy) + bcrypt
- **Session:** express-session + connect-mongo
- **CSS/JS:** Minimal custom CSS (no heavy UI libs)
- **Tenancy:** `/:org` slug prefix; all records carry `companyId`
- **API Style:** RESTful JSON under `/api/:org/...`
- **Time:** Store UTC; render in company timezone (IANA)

---

## 1) MVP Scope (Locked)

### 1.1 Entities (P0)
- **Company (Tenant)**: slug, branding, policies (postingMode, blockedWords, retention)
- **User**: role = `ORG_ADMIN | MODERATOR | MEMBER`; profile; prefs
- **Group**: open/private; owners/moderators/members
- **Post**: type = `TEXT|IMAGE|VIDEO|LINK|POLL|ANNOUNCEMENT|ACHIEVEMENT`; status workflow
- **Comment**: threaded (1 level replies)
- **Reaction**: one per (user,target); types `LIKE|HEART|CELEBRATE|SUPPORT|LAUGH|INSIGHTFUL|THANKS`
- **ApprovalRequest**: moderation queue (when postingMode = MODERATED)
- **AuditLog / EngagementAggregate (lightweight)**: per-post daily rollup

### 1.2 Features (P0)
- **Auth & Session** (register org admin, invite/join, login, logout)
- **Company Feed** (chronological)
- **Posts** (create/read/delete; edit only before publish)
- **Comments** (create/read/delete)
- **Reactions** (toggle)
- **Moderation** (queue, approve/reject; delete/hide post/comment)
- **Per-post metrics** (views, reactions, comments; simple reach est.)
- **Admin** (branding, posting mode, blocked words)
- **Basic Analytics** (top posts, daily active users snapshot)

### 1.3 Non-Goals (MVP defers to V2+)
- External SSO, mobile apps, AI approval, calendar sync, advanced leaderboards, Slack/Teams integrations, file storage beyond basic S3/MinIO adapter

---

## 2) Folder Sketch (target)

app/
server.js
/config
/routes
web/...
api/...
/controllers
/models
/views
/layouts
/partials
/pages
/public
/css /js /img
/middleware
/services
moderation.js
analytics.js
storage.js
/jobs
README.md <-- this file

---

## 3) Routes Map

> All tenant UI under `/:org/...`; all API under `/api/:org/...`

### 3.1 Auth (web)
- `GET  /auth/login` – login page
- `POST /auth/login` – authenticate (Passport local)
- `POST /auth/logout` – destroy session
- `GET  /auth/register-org` – create company & first admin
- `POST /auth/register-org`
- `GET  /auth/invite/:token` – accept invite
- `POST /auth/invite/:token`

### 3.2 Core UI (web)
- `GET  /:org` – company home → redirects to `/:org/feed`
- `GET  /:org/feed` – main feed (posts list)
- `GET  /:org/p/:postId` – post detail with comments
- `GET  /:org/groups` – groups list
- `GET  /:org/g/:groupId` – group feed
- `GET  /:org/profile/:userId` – user profile
- `GET  /:org/admin` – admin home
- `GET  /:org/admin/settings` – branding, policies
- `GET  /:org/mod/queue` – moderation queue
- `GET  /:org/analytics` – simple charts/tables

### 3.3 API – Posts
- `GET    /api/:org/posts?groupId=&q=&page=` – list
- `POST   /api/:org/posts` – create (status: DRAFT/QUEUED/PUBLISHED per policy)
- `GET    /api/:org/posts/:postId` – read
- `PATCH  /api/:org/posts/:postId` – edit (if allowed)
- `DELETE /api/:org/posts/:postId` – soft delete

### 3.4 API – Comments
- `GET    /api/:org/posts/:postId/comments`
- `POST   /api/:org/posts/:postId/comments`
- `DELETE /api/:org/comments/:commentId`

### 3.5 API – Reactions
- `PUT    /api/:org/reactions` – upsert `{targetType, targetId, reactionType}`
- `DELETE /api/:org/reactions` – remove `{targetType, targetId}`

### 3.6 API – Moderation
- `GET    /api/:org/mod/queue` – pending approval items
- `POST   /api/:org/mod/approve` – `{postId}`
- `POST   /api/:org/mod/reject` – `{postId, reason}`
- `POST   /api/:org/mod/hide` – `{targetType, targetId, reason}`
- `POST   /api/:org/mod/delete` – `{targetType, targetId, reason}`

### 3.7 API – Admin / Settings
- `GET    /api/:org/admin/settings`
- `PATCH  /api/:org/admin/settings` – branding, postingMode, blockedWords
- `POST   /api/:org/admin/invite` – invite user by email & role
- `PATCH  /api/:org/admin/users/:userId` – change role/status

### 3.8 API – Analytics (light)
- `GET /api/:org/analytics/posts/:postId` – {views, uniqueViewers, reactionsByType, comments}
- `GET /api/:org/analytics/overview?range=7d|30d` – DAU, top posts, top groups

---

## 4) Backlog (P0 first)

### P0 – Must Have (MVP)
- [ ] Bootstrap project (express, ejs-mate, dotenv, mongoose, passport, session)
- [ ] Models: Company, User, Group, Post, Comment, Reaction, ApprovalRequest, AuditLog, EngagementAggregate
- [ ] Local auth (register-org, login, logout); session store in Mongo
- [ ] Tenant guard middleware (resolve `:org`→companyId)
- [ ] RBAC middleware (`ORG_ADMIN`, `MODERATOR`, `MEMBER`)
- [ ] Feed (list + pagination); Post create/read/delete; Comment CRUD; Reaction toggle
- [ ] Moderation queue (approve/reject)
- [ ] Simple per-post metrics (increment views; daily rollup job)
- [ ] Admin settings (branding, postingMode, blockedWords)
- [ ] Basic error pages (403/404/500)
- [ ] Seed script (dev org, sample users, posts)

### P1 – Nice to Have (If time)
- [ ] Link previews for external URLs
- [ ] File upload (S3/MinIO adapter) with size/type limits
- [ ] Group creation & membership management UI
- [ ] Simple search by keyword/hashtag

---

## 5) Acceptance Criteria (Definition of Done)

- **Auth:** A new org can be created, admin can invite a user, both can log in/out.
- **Feed:** Logged-in member sees tenant feed; can open post detail.
- **Post:** Create post → if `OPEN`, visible immediately; if `MODERATED`, shows in mod queue; delete soft-deletes.
- **Comment:** Add/remove comments; threaded replies (one level).
- **Reaction:** Toggle works; counts update without duplicates.
- **Moderation:** Moderator approves/rejects queued posts with reason trail in AuditLog.
- **Analytics:** Opening a post increments views; an endpoint returns per-post metrics.
- **Admin:** Can switch posting mode, set blocked words; policy enforced on create.
- **Multi-tenancy:** Data isolation validated by companyId on every query.
- **UI:** Minimal, clean EJS pages with layout & partials; mobile-friendly basics.
- **Deploy:** App runs with `MONGODB_URI` and `SESSION_SECRET` on a public host.

---

## 6) Environment Variables

PORT=3000
MONGODB_URI=mongodb://localhost:27017/engage
SESSION_SECRET=change_me
APP_BASE_URL=http://localhost:3000

STORAGE_PROVIDER=local # or s3
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=


---

## 7) Job(s)

- **rollupEngagementDaily** (cron @ 01:00 UTC):
  - For each published post with activity in last 24h → write `EngagementAggregate` (views, uniqueViewers est., reactions, comments).

---

## 8) Milestones (1 hr/day)

- **Days 1–7:** Setup, models, auth, tenant guard, RBAC
- **Days 8–15:** Posts, comments, reactions
- **Days 16–22:** Moderation + admin settings
- **Days 23–30:** Feed polish, groups (basic), link previews (if time)
- **Days 31–38:** Analytics light + UX tidy
- **Days 39–42:** Deploy & config
- **Days 43–45:** Bug bash, demo script, seed data

---

## 9) Notes

- Use **soft delete** for posts/comments; media may be hard-deleted per retention.
- Keep **denormalized counters** consistent; add periodic reconciliation if needed.
- Enforce **unique reaction** per user/target; unique email per company.
