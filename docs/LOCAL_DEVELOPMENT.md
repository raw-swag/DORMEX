# DORMEX — Local Development Runbook (Docker & PostgreSQL)

This guide documents running DORMEX locally using Docker Compose for PostgreSQL and Node.js for backend and frontend services.

---

## 1. Prerequisites
- **Node.js**: v20 or v22 LTS
- **Docker & Docker Compose**: Installed and running (Docker Desktop on Windows/macOS or Docker Engine on Linux)
- **Git**

---

## 2. Quickstart

### Step 1: Clone & Install Dependencies
```bash
git checkout panfam
npm install
```

### Step 2: Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure the default local PostgreSQL string is active in `.env`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dormex
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
COOKIE_SECRET=dormex-super-secure-local-dev-secret-key-32chars
JWT_SECRET=dormex-super-secure-jwt-secret-key-32chars
PG_SSL=false
SEED_DEMO_DATA=true
```

### Step 3: Start PostgreSQL Container
```bash
docker compose up -d
```
Check health:
```bash
docker compose ps
```
The `dormex-postgres` service runs on port `5432` with a persistent Docker volume `dormex_pgdata`.

### Step 4: Bootstrap Database & Start Application
```bash
# Start backend server (runs migrations & seeds development demo accounts automatically)
npm run dev

# In a separate terminal, start Vite frontend development server
npm run dev:client
```
Access the application at `http://localhost:5173`.

---

## 3. Database Management Commands

- **Run Automated Test Suite (uses in-memory PostgreSQL emulator pg-mem)**:
  ```bash
  npm test
  ```
- **Type Checking**:
  ```bash
  npm run typecheck
  ```
- **Build Client Bundle**:
  ```bash
  npm run build:client
  ```
- **Reset Local Database**:
  ```bash
  docker compose down -v
  docker compose up -d
  npm run dev
  ```
