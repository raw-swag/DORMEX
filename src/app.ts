import { getServerConfig } from './config/index.js';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { DatabaseService, getDatabaseService } from './db/index.js';
import { runMigrations } from './db/schema.js';
import { seedDatabase } from './db/seed.js';
import { AllocationEngineService } from './allocation/engine.js';
import { FloorPlanService } from './inventory/floorPlan.js';
import { StudentRegistryService } from './student/registry.js';
import { PreferencesService } from './preferences/service.js';
import { OperationsService } from './operations/service.js';
import { NotificationService } from './notifications/service.js';
import { StudentAdmissionService } from './student/admissionService.js';
import { MessMenuService } from './operations/messMenuService.js';
import { AuthService } from './auth/service.js';
import { DeviceAuthService } from './auth/deviceAuthService.js';
import { GovernanceService } from './auth/governanceService.js';
import { AuthActor, resolveAuthoritativeActor } from './auth/policy.js';

export async function buildApp(db?: DatabaseService): Promise<FastifyInstance> {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET;

  if (isProd && (!jwtSecret || jwtSecret.trim().length < 32)) {
    throw new Error('FATAL_CONFIG_ERROR: Production requires an externally supplied JWT_SECRET with at least 32 characters');
  }

  const app = Fastify({ 
    logger: false,
    bodyLimit: 15 * 1024 * 1024, // 15MB to comfortably accommodate high-res weekly mess menu images
  });
  const database = db || getDatabaseService();

  // Initialize DB schema & seed
  await runMigrations(database);
  await seedDatabase(database);

    const serverConfig = getServerConfig(!!db?.isInMemory || !!database?.isInMemory);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (serverConfig.isDevelopment || serverConfig.isTest) return cb(null, true);
      if (serverConfig.corsAllowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('CORS_POLICY_VIOLATION: Origin not allowed by CORS policy'), false);
    },
    credentials: true,
  });
  await app.register(cookie, {
    secret: serverConfig.auth.cookieSecret || 'dormex-cookie-fallback-secret-2026',
  });

  const effectiveJwtSecret = jwtSecret || 'dormex-super-secure-jwt-signing-key-2026';
  await app.register(fastifyJwt, {
    secret: effectiveJwtSecret,
  });

  const clientDist = path.join(process.cwd(), 'dist', 'client');
  const publicDir = path.join(process.cwd(), 'public');

  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/public/',
      decorateReply: false,
    });
  }

  if (fs.existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      setHeaders: (res, pathName) => {
        // Immutable long-lived caching for Vite content-hashed assets
        if (pathName.includes('/assets/')) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (pathName.endsWith('.html') || pathName.endsWith('sw.js') || pathName.endsWith('manifest.json')) {
          // Sensitive entry points must always revalidate
          res.header('Cache-Control', 'public, max-age=0, must-revalidate');
        }
      },
    });

    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'Endpoint not found' });
      }
      reply.header('Cache-Control', 'public, max-age=0, must-revalidate');
      return reply.sendFile('index.html');
    });
  }

  // Global Security & Anti-Caching Hooks:
  // Strictly prevent shared proxy, CDN, or browser caching of private and authenticated API endpoints
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
    }
  });

  // CSRF Defense Hook for Cookie-Authenticated State-Changing Operations:
  // Protects all mutating HTTP methods (POST, PUT, PATCH, DELETE) against cross-site exploitation.
  // If request relies on cookie authentication (token or demo_session), Origin or Referer must match approved origins.
  app.addHook('preValidation', async (req, reply) => {
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    if (!isMutation || !req.url.startsWith('/api')) {
      return;
    }

    // Skip public unauthenticated endpoints (login, password reset, demo assertion verification)
    const publicExemptions = [
      '/api/auth/login',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/demo/auth/verify',
    ];
    if (publicExemptions.some(p => req.url.startsWith(p))) {
      return;
    }

    // Check if request relies on cookie authentication
    const hasAuthCookie = !!(req.cookies?.token || req.cookies?.demo_session);
    const hasBearerHeader = !!(req.headers['authorization'] || req.headers['Authorization']);

    // If request uses cookie authentication without an explicit Bearer header, enforce strict origin validation
    if (hasAuthCookie && !hasBearerHeader) {
      const originHeader = req.headers['origin'] || req.headers['Origin'];
      const refererHeader = req.headers['referer'] || req.headers['Referer'];
      const candidateHeader = originHeader || refererHeader;

      if (!candidateHeader || typeof candidateHeader !== 'string') {
        return reply.code(403).send({
          error: 'CSRF_PROTECTION_VIOLATION: Missing origin or referer header on cookie-authenticated mutation',
        });
      }

      try {
        const u = new URL(candidateHeader);
        const requestOrigin = `${u.protocol}//${u.host}`;
        const approved = serverConfig.corsAllowedOrigins;

        if (!approved.includes(requestOrigin)) {
          return reply.code(403).send({
            error: 'CSRF_PROTECTION_VIOLATION: Cross-origin mutation request rejected',
          });
        }
      } catch {
        return reply.code(403).send({
          error: 'CSRF_PROTECTION_VIOLATION: Malformed origin header on state-changing request',
        });
      }
    }
  });

  const allocationEngine = new AllocationEngineService(database);
  const floorPlanService = new FloorPlanService(database);
  const studentRegistry = new StudentRegistryService(database);
  const preferencesService = new PreferencesService(database);
  const operationsService = new OperationsService(database);
  const notificationService = new NotificationService(database);
  const admissionService = new StudentAdmissionService(database);
  const messMenuService = new MessMenuService(database);
  const authService = new AuthService(database);
  const deviceAuthService = new DeviceAuthService(database);
  (app as any).deviceAuthService = deviceAuthService;
  const governanceService = new GovernanceService(database);
  (app as any).governanceService = governanceService;

  // Helper auth extractor (enforces cryptographically signed JWT tokens, with test/dev compatibility)
  const extractActor = async (req: any): Promise<AuthActor> => {
    let userId: string | null = null;

    // 1. Check Authorization Bearer header first
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.trim().split(' ');
      if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        throw new Error('UNAUTHORIZED: Malformed Authorization header');
      }
      const token = parts[1];
      try {
        const decoded = (await app.jwt.verify(token)) as any;
        if (!decoded || !decoded.sub) {
          throw new Error('UNAUTHORIZED: Missing mandatory identity claims');
        }
        userId = decoded.sub;
      } catch (err: any) {
        if (err.message?.startsWith('UNAUTHORIZED')) {
          throw err;
        }
        if (err.code === 'FAST_JWT_EXPIRED' || err.message?.toLowerCase().includes('expired')) {
          throw new Error('UNAUTHORIZED: Token expired');
        }
        if (err.code === 'FAST_JWT_INVALID_SIGNATURE' || err.message?.toLowerCase().includes('signature')) {
          throw new Error('UNAUTHORIZED: Invalid signature');
        }
        throw new Error(`UNAUTHORIZED: Malformed or invalid token (${err.message})`);
      }
    }

    // 2. Fall back to signed cookie if present
    if (!userId && req.cookies?.token) {
      try {
        const decoded = (await app.jwt.verify(req.cookies.token)) as any;
        if (decoded?.sub) {
          userId = decoded.sub;
        }
      } catch (err: any) {
        if (err.code === 'FAST_JWT_EXPIRED') {
          throw new Error('UNAUTHORIZED: Token expired');
        }
        throw new Error('UNAUTHORIZED: Invalid session cookie');
      }
    }

    // 3. Isolated test identity fallback:
    // Strictly limited to NODE_ENV=test for headless unit/integration suites.
    // Development environment shortcuts via headers are disabled to eliminate any reverse-proxy spoofing risk.
    if (!userId && process.env.NODE_ENV === 'test' && req.headers['x-user-id']) {
      userId = req.headers['x-user-id'];
    }

    // 4. In production, development, or any non-test environment, unauthenticated requests are strictly rejected
    if (!userId) {
      throw new Error('UNAUTHORIZED: Missing or unauthenticated credentials');
    }

    // 5. Canonical database actor lookup and mapping
    // Load live role, active appointment, and building binding directly from database
    const userRes = await database.query(
      `SELECT u.id, u.college_id, u.full_name, r.name as role_name, ur.scope_type, ur.scope_id, sp.id as profile_id,
              COALESCE(wa.id, da.id) as active_appointment_id,
              COALESCE(wa.appointment_status, da.appointment_status) as active_appointment_status,
              da.supervisor_warden_appt_id
       FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       LEFT JOIN student_profiles sp ON u.id = sp.user_id
       LEFT JOIN warden_appointments wa ON u.id = wa.user_id AND wa.appointment_status = 'ACTIVE'
       LEFT JOIN deputy_appointments da ON u.id = da.user_id AND da.appointment_status = 'ACTIVE'
       WHERE u.id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('UNAUTHORIZED: Invalid credentials');
    }

    return resolveAuthoritativeActor(userRes.rows);
  };

  // Liveness probe (process is running and event loop is responding; does NOT depend on PostgreSQL)
  app.get('/health', async () => ({
    status: 'UP',
    service: 'DORMEX Hostel Allocation Engine',
    timestamp: new Date().toISOString(),
  }));

  // Readiness probe (verifies PostgreSQL database connection is alive and queryable)
  app.get('/readyz', async (req, reply) => {
    let dbStatus = 'UNKNOWN';
    try {
      const dbCheck = await database.query('SELECT 1 as alive');
      dbStatus = dbCheck.rows[0]?.alive === 1 ? 'CONNECTED' : 'DISCONNECTED';
    } catch {
      dbStatus = 'DISCONNECTED';
    }

    const isReady = dbStatus === 'CONNECTED';
    return reply.code(isReady ? 200 : 503).send({
      status: isReady ? 'READY' : 'NOT_READY',
      database: dbStatus,
      environment: process.env.NODE_ENV || 'development',
      service: 'DORMEX Hostel Allocation Engine',
      timestamp: new Date().toISOString(),
    });
  });

  // Authentication & Session Endpoints
  app.post('/api/auth/login', async (req: any, reply) => {
    try {
      const { identifier, password, collegeIdOrEmail } = (req.body || {}) as any;
      const cleanId = (identifier || collegeIdOrEmail || '').trim().toLowerCase();
      const rawPassword = password || '';

      if (!cleanId) {
        return reply.code(400).send({ error: 'IDENTIFIER_REQUIRED: Institutional ID or email is required' });
      }

      const userRes = await database.query(
        `SELECT u.id, u.college_id, u.email, u.full_name, u.password_hash, u.is_active,
                r.name as role_name, ur.scope_type, ur.scope_id, sp.id as profile_id
         FROM users u
         JOIN user_roles ur ON u.id = ur.user_id
         JOIN roles r ON ur.role_id = r.id
         LEFT JOIN student_profiles sp ON u.id = sp.user_id
         WHERE LOWER(u.college_id) = $1 OR LOWER(u.email) = $1`,
        [cleanId]
      );

      if (userRes.rows.length === 0) {
        return reply.code(401).send({ error: 'UNAUTHORIZED: Invalid credentials' });
      }

      const user = userRes.rows[0];
      if (!user.is_active) {
        return reply.code(401).send({ error: 'UNAUTHORIZED: Account is deactivated' });
      }

      const passwordValid = authService.verifyPassword(rawPassword, user.password_hash);
      if (!passwordValid) {
        return reply.code(401).send({ error: 'UNAUTHORIZED: Invalid credentials' });
      }

      // Generate signed JWT token
      const token = app.jwt.sign(
        {
          sub: user.id,
          role: user.role_name,
          college_id: user.college_id,
          student_profile_id: user.profile_id,
        },
        { expiresIn: '24h' }
      );

      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });

      return reply.send({
        success: true,
        token,
        session: {
          userId: user.id,
          collegeId: user.college_id,
          fullName: user.full_name,
          role: user.role_name,
          scopeType: user.scope_type,
          scopeId: user.scope_id,
          profileId: user.profile_id,
        },
      });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/auth/me', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      return reply.send({
        userId: actor.id,
        collegeId: actor.college_id,
        fullName: actor.full_name || actor.college_id,
        role: actor.role,
        scopeType: actor.scope_type,
        scopeId: actor.scope_id,
        profileId: actor.student_profile_id,
        activeAppointmentId: actor.active_appointment_id || null,
        activeAppointmentStatus: actor.active_appointment_status || null,
      });
    } catch (err: any) {
      return reply.code(401).send({ error: err.message });
    }
  });

  app.post('/api/auth/logout', async (req: any, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  app.post('/api/auth/forgot-password', async (req: any, reply) => {
    try {
      const { identifier } = (req.body || {}) as any;
      const result = await authService.requestPasswordReset(identifier, req.ip);
      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/auth/reset-password', async (req: any, reply) => {
    try {
      const { token, newPassword } = (req.body || {}) as any;
      const result = await authService.resetPasswordWithToken(token, newPassword);
      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Student Registry routes
  app.get('/api/students', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const query = req.query || {};
      const students = await studentRegistry.listStudents(actor, {
        academicYear: query.academicYear ? parseInt(query.academicYear, 10) : undefined,
        quota: query.quota,
        search: query.search,
      });
      return reply.send(students);
    } catch (err: any) {
      return reply.code(err.message?.startsWith('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  app.post('/api/students', async (req, reply) => {
    try {
      const actor = await extractActor(req);
      const result = await studentRegistry.registerStudent(req.body as any, actor);
      return reply.code(201).send(result);
    } catch (err: any) {
      return reply.code(err.message?.startsWith('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  app.get('/api/students/:id', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const profile = await studentRegistry.getProfile(req.params.id, actor);
      return reply.send(profile);
    } catch (err: any) {
      return reply.code(err.message?.startsWith('FORBIDDEN') ? 403 : 404).send({ error: err.message });
    }
  });

  app.put('/api/students/:id/eligibility', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { status } = req.body as any;
      await studentRegistry.updateEligibility(req.params.id, status, actor);
      return reply.send({ success: true, message: 'Student eligibility updated successfully' });
    } catch (err: any) {
      return reply.code(err.message?.startsWith('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  app.put('/api/students/:id/priority', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { priority } = req.body as any;
      await studentRegistry.updatePriority(req.params.id, priority, actor);
      return reply.send({ success: true, message: 'Student priority updated successfully' });
    } catch (err: any) {
      return reply.code(err.message?.startsWith('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  // Buildings & Floors Inventory
  app.get('/api/buildings', async () => {
    const res = await database.query(`SELECT * FROM buildings WHERE is_active = TRUE ORDER BY code ASC`);
    return res.rows;
  });

  app.get('/api/buildings/:id/floors', async (req: any) => {
    const res = await database.query(
      `SELECT * FROM floors WHERE building_id = $1 ORDER BY floor_number ASC`,
      [req.params.id]
    );
    return res.rows;
  });

  app.get('/api/allocation-cycles', async () => {
    const res = await database.query(`SELECT * FROM allocation_cycles ORDER BY created_at DESC`);
    return res.rows;
  });

  app.get('/api/admin/overview', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (['STUDENT', 'PROCTOR'].includes(actor.role)) {
        return reply.code(403).send({ error: 'FORBIDDEN: Insufficient permissions' });
      }

      const totalSeatsRes = await database.query(`SELECT COUNT(*) as count FROM seats`);
      const occupiedSeatsRes = await database.query(`SELECT COUNT(*) as count FROM allocations WHERE status = 'CURRENT'`);
      const studentsRes = await database.query(`SELECT COUNT(*) as count FROM student_profiles`);
      const complaintsRes = await database.query(`SELECT COUNT(*) as count FROM complaints WHERE status = 'OPEN'`);
      const buildingsRes = await database.query(`SELECT COUNT(*) as count FROM buildings`);

      const activeSeatsRes = await database.query(`SELECT COUNT(*) as count FROM seats WHERE status = 'ACTIVE'`);
      const activeCount = parseInt(activeSeatsRes.rows[0].count, 10);
      const occupiedCount = parseInt(occupiedSeatsRes.rows[0].count, 10);
      const availableCount = Math.max(0, activeCount - occupiedCount);

      const blockedSeatsRes = await database.query(`SELECT COUNT(*) as count FROM seats WHERE status = 'BLOCKED'`);
      const maintenanceSeatsRes = await database.query(`SELECT COUNT(*) as count FROM seats WHERE status = 'MAINTENANCE'`);
      const totalRoomsRes = await database.query(`SELECT COUNT(*) as count FROM rooms`);
      const eligibleStudentsRes = await database.query(`SELECT COUNT(*) as count FROM student_profiles WHERE eligibility_status = 'ELIGIBLE'`);

      return {
        totalSeats: parseInt(totalSeatsRes.rows[0].count, 10),
        occupiedSeats: occupiedCount,
        availableSeats: availableCount,
        blockedSeats: parseInt(blockedSeatsRes.rows[0].count, 10),
        maintenanceSeats: parseInt(maintenanceSeatsRes.rows[0].count, 10),
        totalRooms: parseInt(totalRoomsRes.rows[0].count, 10),
        registeredStudents: parseInt(studentsRes.rows[0].count, 10),
        eligibleStudents: parseInt(eligibleStudentsRes.rows[0].count, 10),
        openComplaints: parseInt(complaintsRes.rows[0].count, 10),
        totalBuildings: parseInt(buildingsRes.rows[0].count, 10),
      };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Administrative Occupancy and Allocation Reports Export Endpoint
  app.get('/api/admin/reports/occupancy', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (!['WARDEN', 'CHIEF_WARDEN', 'HOSTEL_OFFICE', 'SUPER_ADMIN'].includes(actor.role)) {
        return reply.code(403).send({ error: 'FORBIDDEN: Insufficient permissions to generate occupancy reports' });
      }

      const format = req.query?.format || 'json';
      const buildingId = req.query?.buildingId;

      let query = `
        SELECT 
          b.name as building_name,
          f.floor_number,
          r.room_number,
          r.room_type,
          s.seat_label,
          s.status as seat_status,
          a.status as allocation_status,
          sp.college_id as student_usn,
          sp.full_name as student_name,
          sp.department as branch,
          sp.quota_category,
          a.allocated_at as confirmed_at
        FROM seats s
        JOIN rooms r ON s.room_id = r.id
        JOIN floors f ON r.floor_id = f.id
        JOIN buildings b ON f.building_id = b.id
        LEFT JOIN allocations a ON s.id = a.seat_id AND a.status = 'CURRENT'
        LEFT JOIN student_profiles sp ON a.student_id = sp.id
      `;
      const params: any[] = [];
      if (buildingId) {
        query += ` WHERE b.id = $1`;
        params.push(buildingId);
      }
      query += ` ORDER BY b.name ASC, f.floor_number ASC, r.room_number ASC, s.seat_label ASC`;

      const res = await database.query(query, params);

      if (format === 'csv') {
        const header = ['Building', 'Floor', 'Room', 'Type', 'Seat', 'Seat Status', 'Allocated', 'Student USN', 'Student Name', 'Branch', 'Quota', 'Confirmed At'];
        const rows = res.rows.map((row: any) => [
          `"${row.building_name}"`,
          row.floor_number,
          `"${row.room_number}"`,
          `"${row.room_type || 'STANDARD'}"`,
          `"${row.seat_label}"`,
          `"${row.seat_status}"`,
          row.allocation_status ? '"YES"' : '"NO"',
          `"${row.student_usn || ''}"`,
          `"${row.student_name || ''}"`,
          `"${row.branch || ''}"`,
          `"${row.quota_category || ''}"`,
          `"${row.confirmed_at ? new Date(row.confirmed_at).toISOString() : ''}"`
        ]);
        const csvContent = [header.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', 'attachment; filename="dormex_occupancy_report.csv"');
        return reply.send(csvContent);
      }

      return reply.send({
        generatedAt: new Date().toISOString(),
        totalRecords: res.rows.length,
        records: res.rows
      });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Admin rooms inventory endpoint with status updates
  app.get('/api/floors/:id/rooms', async (req: any, reply) => {
    try {
      const res = await database.query(
        `SELECT r.*, 
                COUNT(s.id) as total_seats,
                COUNT(CASE WHEN s.status = 'ACTIVE' AND a.id IS NULL THEN 1 END) as available_seats,
                COUNT(CASE WHEN a.id IS NOT NULL THEN 1 END) as occupied_seats
         FROM rooms r
         LEFT JOIN seats s ON r.id = s.room_id
         LEFT JOIN allocations a ON s.id = a.seat_id AND a.status = 'CURRENT'
         WHERE r.floor_id = $1
         GROUP BY r.id
         ORDER BY r.room_number ASC`,
        [req.params.id]
      );
      return reply.send(res.rows);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Admin seat status toggle (maintenance, blocked, active)
  app.put('/api/seats/:id/status', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (!['WARDEN', 'CHIEF_WARDEN', 'HOSTEL_OFFICE', 'SUPER_ADMIN'].includes(actor.role)) {
        return reply.code(403).send({ error: 'FORBIDDEN: Insufficient permissions to update seat status' });
      }
      const { status } = req.body as any;
      if (!['ACTIVE', 'BLOCKED', 'MAINTENANCE'].includes(status)) {
        return reply.code(400).send({ error: 'INVALID_STATUS: Must be ACTIVE, BLOCKED, or MAINTENANCE' });
      }

      await database.query(
        `UPDATE seats SET status = $1 WHERE id = $2`,
        [status, req.params.id]
      );
      return reply.send({ success: true, seatId: req.params.id, status });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Admin cycle status toggle (e.g. manual early start for pilot)
  app.put('/api/allocation-cycles/:id/status', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (!['HOSTEL_OFFICE', 'SUPER_ADMIN', 'CHIEF_WARDEN'].includes(actor.role)) {
        return reply.code(403).send({ error: 'FORBIDDEN: Insufficient permissions to manage allocation cycle status' });
      }
      const { status, waitingRoomThreshold } = req.body as any;
      if (status) {
        if (['READY', 'SIMULATING'].includes(status)) {
          // Architectural guarantee: Validate disjoint seat inventories across active pools
          await allocationEngine.validatePoolDisjointInventory(req.params.id);
        }
        if (status === 'PUBLISHED') {
          await database.query(`UPDATE allocation_cycles SET status = $1, results_published_at = CURRENT_TIMESTAMP WHERE id = $2`, [status, req.params.id]);
          await notificationService.createNotification({
            category: 'ALLOTMENT',
            priority: 'HIGH',
            title: 'Official Allocation Results Certified & Published',
            message: `Official allocation results are now live for cycle ${req.params.id}. You can inspect final room allocations and submit 48-hour room change requests.`,
            target_audience: 'ALL',
            reference_id: req.params.id,
            reference_type: 'ALLOCATION_CYCLE',
            author_name: 'Hostel Office',
          });
        } else if (status === 'LOCKED') {
          await database.query(`UPDATE allocation_cycles SET status = $1, config_frozen_at = CURRENT_TIMESTAMP WHERE id = $2`, [status, req.params.id]);
          await notificationService.createNotification({
            category: 'ALLOTMENT',
            priority: 'NORMAL',
            title: 'Allocation Cycle Archived & Locked',
            message: `Allocation cycle ${req.params.id} has been formally locked. Final seat configurations are permanent.`,
            target_audience: 'ALL',
            reference_id: req.params.id,
            reference_type: 'ALLOCATION_CYCLE',
            author_name: 'System Administration',
          });
        } else {
          await database.query(`UPDATE allocation_cycles SET status = $1 WHERE id = $2`, [status, req.params.id]);
        }
      }
      if (waitingRoomThreshold !== undefined) {
        await database.query(`UPDATE allocation_cycles SET waiting_room_threshold = $1 WHERE id = $2`, [waitingRoomThreshold, req.params.id]);
      }
      return reply.send({ success: true, message: `Cycle updated to ${status} successfully` });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Explicit Admin Allocation Lifecycle Controls: START
  app.post('/api/allocation-cycles/:id/start', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const result = await allocationEngine.startCycle(req.params.id, actor);
      // Initialize first turn for active pools
      const poolsRes = await database.query(
        `SELECT id FROM allocation_pools WHERE cycle_id = $1 AND is_active = TRUE`,
        [req.params.id]
      );
      for (const pool of poolsRes.rows) {
        await allocationEngine.advancePoolTurn(pool.id).catch(() => {});
      }
      return reply.send(result);
    } catch (err: any) {
      const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Explicit Admin Allocation Lifecycle Controls: STOP (Pause)
  app.post('/api/allocation-cycles/:id/stop', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const result = await allocationEngine.stopCycle(req.params.id, actor);
      return reply.send(result);
    } catch (err: any) {
      const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Explicit Admin Allocation Lifecycle Controls: RESUME
  app.post('/api/allocation-cycles/:id/resume', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const result = await allocationEngine.resumeCycle(req.params.id, actor);
      return reply.send(result);
    } catch (err: any) {
      const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Authoritative Cycle Active Turn telemetry endpoint
  app.get('/api/allocation-cycles/:id/active-turn', async (req: any, reply) => {
    try {
      const turnInfo = await allocationEngine.getActiveTurn(req.params.id);
      return reply.send(turnInfo);
    } catch (err: any) {
      const code = err.message?.startsWith('NOT_FOUND') ? 404 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Authoritative Student Active Turn Poll endpoint (read-only telemetry, does not advance turn)
  app.get('/api/allocation-pools/:id/active-turn', async (req: any, reply) => {
    try {
      const poolRes = await database.query(
        `SELECT cycle_id FROM allocation_pools WHERE id = $1`,
        [req.params.id]
      );
      if (poolRes.rows.length === 0) {
        return reply.code(404).send({ error: 'Allocation pool not found' });
      }
      const cycleId = poolRes.rows[0].cycle_id;
      const turnInfo = await allocationEngine.getActiveTurn(cycleId);
      return reply.send({ session: turnInfo.session, cycleStatus: turnInfo.cycleStatus });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Cycle Simulation / Dry-Run Prediction
  app.post('/api/allocation-cycles/:id/simulate', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const simulation = await allocationEngine.simulateCycle(req.params.id, actor);
      return reply.send(simulation);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Inventory & Floor Plan routes
  app.post('/api/floors/:id/draft', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { geometry } = req.body as any;
      const result = await floorPlanService.saveDraft(req.params.id, geometry, actor);
      return reply.code(201).send(result);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/floors/:id/publish', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { version } = req.body as any;
      await floorPlanService.publishMap(req.params.id, version, actor);
      return reply.send({ success: true, message: 'Floor map published successfully' });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.get('/api/floors/:id/map', async (req: any, reply) => {
    const map = await floorPlanService.getPublishedMap(req.params.id);
    if (!map) {
      return reply.code(404).send({ error: 'Published floor map not found' });
    }
    return reply.send(map);
  });

  app.get('/api/floors/:id/state', async (req: any) => {
    const allocRes = await database.query(
      `SELECT s.id as seat_id, a.id as alloc_id
       FROM seats s
       JOIN rooms r ON s.room_id = r.id
       LEFT JOIN allocations a ON s.id = a.seat_id AND a.status = 'CURRENT'
       WHERE r.floor_id = $1`,
      [req.params.id]
    );

    const seatStatus: Record<string, string> = {};
    for (const row of allocRes.rows) {
      seatStatus[row.seat_id] = row.alloc_id ? 'taken' : 'free';
    }
    return seatStatus;
  });

  app.get('/api/floors/:id/svg', async (req: any, reply) => {
    const map = await floorPlanService.getPublishedMap(req.params.id);
    if (!map) {
      return reply.code(404).send({ error: 'Published floor map not found' });
    }
    // Fetch seat allocations for the floor to colorize seats
    const allocRes = await database.query(
      `SELECT s.id as seat_id, a.id as alloc_id
       FROM seats s
       JOIN rooms r ON s.room_id = r.id
       LEFT JOIN allocations a ON s.id = a.seat_id AND a.status = 'CURRENT'
       WHERE r.floor_id = $1`,
      [req.params.id]
    );

    const seatStatus: Record<string, string> = {};
    for (const row of allocRes.rows) {
      seatStatus[row.seat_id] = row.alloc_id ? 'taken' : 'free';
    }

    const svg = floorPlanService.renderFloorSvg(map, seatStatus);
    return reply.type('image/svg+xml').send(svg);
  });

  // Allocation Cycle routes
  app.post('/api/allocation-cycles/:id/join', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { studentProfileId } = req.body as any;
      const res = await allocationEngine.joinWaitingRoom(req.params.id, studentProfileId, actor);
      return reply.send(res);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/allocation-pools/:id/advance', async (req: any, reply) => {
    try {
      const session = await allocationEngine.advancePoolTurn(req.params.id);
      return reply.send({ session });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/booking-sessions/:id/confirm-seat', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { seatId, idempotencyKey } = req.body as any;
      const result = await allocationEngine.confirmSeat(req.params.id, seatId, actor, idempotencyKey);
      
      // Architectural optimization: Advance turn immediately on confirm
      // To prevent waiting out the wall clock when the current student completes early
      const sessRes = await database.query('SELECT pool_id FROM booking_sessions WHERE id = $1', [req.params.id]);
      if (sessRes.rows.length > 0 && sessRes.rows[0].pool_id) {
        // Asynchronously advance to the next waiting student without blocking the confirmation response
        allocationEngine.advancePoolTurn(sessRes.rows[0].pool_id).catch(() => {});
      }

      return reply.send(result);
    } catch (err: any) {
      const msg = err.message || '';
      let code = 400;
      if (msg.startsWith('FORBIDDEN') || msg.startsWith('NOT_YOUR_TURN')) code = 403;
      if (msg.startsWith('SEAT_UNAVAILABLE')) code = 409;
      return reply.code(code).send({ error: msg });
    }
  });

  // Administrative Audit Trail Endpoint
  app.get('/api/admin/audit-logs', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (!['HOSTEL_OFFICE', 'SUPER_ADMIN', 'CHIEF_WARDEN'].includes(actor.role)) {
        return reply.code(403).send({ error: 'FORBIDDEN: Insufficient permissions to inspect administrative audit logs' });
      }
      const res = await database.query(
        `SELECT a.*, u.full_name as actor_name, u.email as actor_email
         FROM audit_logs a
         LEFT JOIN users u ON a.actor_id = u.id
         ORDER BY a.created_at DESC
         LIMIT 50`
      );
      return reply.send(res.rows);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Super Admin Force Override route
  app.post('/api/admin/allocations/force-override', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { cycleId, studentId, seatId, reason } = req.body as any;
      const result = await allocationEngine.forceOverrideAllocation(cycleId, studentId, seatId, reason, actor);
      return reply.send(result);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Wishlist & Invites
  app.post('/api/seats/:id/wishlist', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { cycleId, studentProfileId } = req.body as any;
      await preferencesService.addWishlist(cycleId, studentProfileId, req.params.id, actor);
      return reply.send({ success: true });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/invites', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { cycleId, seatId, fromStudentId } = req.body as any;
      const result = await preferencesService.createInvite(cycleId, fromStudentId, seatId, actor);
      return reply.code(201).send(result);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Operations: Complaints & Room Changes
  app.post('/api/complaints', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const result = await operationsService.submitComplaint(req.body as any, actor);
      return reply.code(201).send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/complaints', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const res = await operationsService.listComplaints(actor, req.query?.buildingId);
      return reply.send(res.rows);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.put('/api/complaints/:id', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      await operationsService.updateComplaint(req.params.id, req.body as any, actor);
      return reply.send({ success: true, message: 'Complaint updated' });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/complaints/:id/vote', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      await operationsService.voteComplaint(req.params.id, actor);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/room-change-requests', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { cycleId, studentProfileId, targetRoomId, reason } = req.body as any;
      const res = await operationsService.requestRoomChange(cycleId, studentProfileId, targetRoomId, reason, actor);
      return reply.code(201).send(res);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/room-change-requests', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const requests = await operationsService.listRoomChangeRequests(actor, req.query?.cycleId);
      return reply.send(requests);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.put('/api/room-change-requests/:id/review', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { decision, notes, targetSeatId } = req.body as any;
      await operationsService.reviewRoomChange(req.params.id, decision, notes, actor, targetSeatId);
      return reply.send({ success: true, message: `Room change request ${decision.toLowerCase()} successfully` });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/room-change-requests/in-person', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { cycleId, studentProfileId, targetRoomId, reason, autoApprove } = req.body as any;
      const res = await operationsService.recordInPersonRoomChange(cycleId, studentProfileId, targetRoomId, reason, actor, autoApprove);
      return reply.code(201).send(res);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Terms and Conditions Endpoints
  app.get('/api/terms/latest', async () => {
    return studentRegistry.getLatestTerms();
  });

  app.get('/api/students/:id/terms-status', async (req: any, reply) => {
    try {
      const status = await studentRegistry.getStudentTermsStatus(req.params.id);
      return reply.send(status);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/students/:id/accept-terms', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const body = (req.body || {}) as any;

      if (!req.body || typeof req.body !== 'object') {
        return reply.code(400).send({ error: 'INVALID_PAYLOAD: Request body is required' });
      }

      if (body.acknowledged !== undefined && body.acknowledged !== true) {
        return reply.code(400).send({ error: 'ACKNOWLEDGEMENT_REQUIRED: Terms acknowledgement must be explicitly confirmed' });
      }

      const { termsVersion } = body;
      if (!termsVersion || typeof termsVersion !== 'number' || termsVersion <= 0) {
        return reply.code(400).send({ error: 'INVALID_TERMS_VERSION: Valid positive terms version number is required' });
      }

      await studentRegistry.acceptTerms(req.params.id, termsVersion, actor, req.ip);
      return reply.send({
        success: true,
        message: 'Hostel Responsibility terms accepted successfully',
        termsVersion,
        studentId: req.params.id,
      });
    } catch (err: any) {
      if (err.message?.startsWith('UNAUTHORIZED')) {
        return reply.code(401).send({ error: err.message });
      }
      if (err.message?.startsWith('FORBIDDEN')) {
        return reply.code(403).send({ error: err.message });
      }
      return reply.code(400).send({ error: err.message });
    }
  });

  // Student Onboarding Profile Endpoints
  app.put('/api/students/:id/profile', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      await studentRegistry.updateStudentProfile(req.params.id, req.body as any, actor);
      return reply.send({ success: true, message: 'Profile updated successfully' });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/students/:id/submit-profile', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      await studentRegistry.submitStudentProfile(req.params.id, actor);
      return reply.send({ success: true, message: 'Profile submitted for Hostel Office review' });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Fee Verification & Priority Recalculation Endpoints (Hostel Office)
  app.put('/api/students/:id/verify-fee', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      await studentRegistry.verifyFeePayment(req.params.id, req.body as any, actor);
      return reply.send({ success: true, message: 'Fee payment verified successfully' });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/students/recalculate-priorities', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { academicYear, quotaCategory } = req.body as any;
      const res = await studentRegistry.recalculatePrioritiesByPayment(academicYear || 2, quotaCategory || 'GENERAL', actor);
      return reply.send({ success: true, updatedCount: res.updatedCount });
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Roommate Group Coordination Endpoints
  app.post('/api/roommate-groups', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { cycleId, leaderStudentId, roomId, peerPriorityNumbers } = req.body as any;
      const res = await preferencesService.createRoommateGroup(cycleId, leaderStudentId, roomId, peerPriorityNumbers, actor);
      return reply.code(201).send(res);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.post('/api/roommate-groups/:id/respond', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { studentProfileId, accept } = req.body as any;
      const res = await preferencesService.respondToRoommateInvite(req.params.id, studentProfileId, accept, actor);
      return reply.send(res);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.get('/api/roommate-groups/student/:id', async (req: any, reply) => {
    try {
      const cycleId = req.query?.cycleId || 'cyc_bvb_pilot_2026';
      const groups = await preferencesService.getStudentRoommateGroups(req.params.id, cycleId);
      return reply.send(groups);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/floors/:id/roommate-intent', async (req: any, reply) => {
    try {
      const cycleId = req.query?.cycleId || 'cyc_bvb_pilot_2026';
      const map = await preferencesService.getRoommateIntentSeats(req.params.id, cycleId);
      return reply.send(map);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Notifications & Announcements Endpoints
  app.get('/api/notifications', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const res = await notificationService.listNotifications(actor);
      return reply.send(res);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/notifications/mark-read', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { id, all } = (req.body as any) || {};
      if (all) {
        await notificationService.markAllAsRead(actor);
      } else if (id) {
        await notificationService.markAsRead(id, actor);
      }
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/admin/notices', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const notice = await notificationService.publishNotice(req.body as any, actor);
      return reply.code(201).send(notice);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Student Admission Management Endpoints (Hostel Office Workspace)
  app.post('/api/admissions', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const result = await admissionService.createAdmission(req.body as any, actor);
      return reply.code(201).send(result);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.get('/api/admissions', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const list = await admissionService.listAdmissions(actor, req.query as any);
      return reply.send(list);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.get('/api/admissions/proctors', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const proctors = await admissionService.listProctors(actor);
      return reply.send(proctors);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.get('/api/admissions/:id', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const admission = await admissionService.getAdmission(req.params.id, actor);
      return reply.send(admission);
    } catch (err: any) {
      const code = err.message?.startsWith('FORBIDDEN') ? 403 : err.message?.startsWith('NOT_FOUND') ? 404 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.put('/api/admissions/:id', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const updated = await admissionService.updateAdmission(req.params.id, req.body as any, actor);
      return reply.send(updated);
    } catch (err: any) {
      const code = err.message?.startsWith('FORBIDDEN') ? 403 : err.message?.startsWith('NOT_FOUND') ? 404 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  // Weekly Mess Menu Management Endpoints
  app.post('/api/mess/menus', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      let payload = req.body;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          return reply.code(400).send({ error: 'VALIDATION_ERROR: Invalid JSON request body' });
        }
      }
      const menu = await messMenuService.uploadMenu((payload || {}) as any, actor);
      return reply.code(201).send(menu);
    } catch (err: any) {
            const code = err.message?.startsWith('FORBIDDEN') ? 403 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.put('/api/mess/menus/:id/status', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { status } = req.body as any;
      const updated = await messMenuService.updateMenuStatus(req.params.id, status, actor);
      return reply.send(updated);
    } catch (err: any) {
      const code = err.message?.startsWith('FORBIDDEN') ? 403 : err.message?.startsWith('NOT_FOUND') ? 404 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });

  app.get('/api/mess/menu/active', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const scope = (req.query?.scope as string) || 'CAMPUS_CENTRAL';
      const date = req.query?.date as string | undefined;
      const menu = await messMenuService.getActiveMenu(scope, actor, date);
      return reply.send(menu);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/mess/menus', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const scope = (req.query?.scope as string) || 'CAMPUS_CENTRAL';
      const menus = await messMenuService.listMenus(actor, scope);
      return reply.send(menus);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });


  // =========================================================================
  // WebAuthn Two-Device Demo Authentication & Administration Endpoints
  // =========================================================================

  // Helper to extract demo session
  const extractDemoSession = async (req: any) => {
    const demoCookie = req.cookies?.demo_session;
    const authHeader = req.headers['x-demo-session'];
    const token = demoCookie || (typeof authHeader === 'string' ? authHeader : undefined);
    return await deviceAuthService.validateDemoSession(token);
  };

  // UI Authorization probe: GET /api/demo/access
  // Returns demo availability only after successful WebAuthn authentication on registered device
  app.get('/api/demo/access', async (req: any, reply) => {
    const session = await extractDemoSession(req);
    if (!session) {
      return reply.code(403).send({
        authorized: false,
        error: 'FORBIDDEN: Demo entry point is restricted to authorized hardware-bound devices (SLOT_01, SLOT_02, or SLOT_03).',
      });
    }

    return reply.send({
      authorized: true,
      slot_id: session.slot_id,
      device_label: session.device_label,
      platform: session.platform,
      user_verified: session.user_verified,
      expires_at: session.expires_at,
    });
  });

  // Dynamic Demo Accounts Endpoint: GET /api/demo/accounts
  // Restricted to authorized hardware-bound demo devices only
  app.get('/api/demo/accounts', async (req: any, reply) => {
    const session = await extractDemoSession(req);
    if (!session) {
      return reply.code(403).send({
        error: 'FORBIDDEN: Demo account directory is restricted to authorized hardware-bound devices.',
      });
    }
    try {
      const { accounts } = await deviceAuthService.getAuthorizedDemoAccounts();
      return reply.send({
        success: true,
        slot_id: session.slot_id,
        accounts,
      });
    } catch (err: any) {
      return reply.code(err.message?.startsWith('DEMO_ACCOUNTS_MISSING') ? 500 : 400).send({
        error: err.message || 'Failed to retrieve demo accounts',
      });
    }
  });

  // Protected Demo API sample / data: returns 403 unless valid device-bound session
  app.get('/api/demo/overview', async (req: any, reply) => {
    const session = await extractDemoSession(req);
    if (!session) {
      return reply.code(403).send({
        error: 'FORBIDDEN: Demo access requires device-bound platform authentication.',
      });
    }

    return reply.send({
      status: 'DEMO_ACTIVE',
      device: {
        slot_id: session.slot_id,
        device_label: session.device_label,
        platform: session.platform,
        user_verified: session.user_verified,
      },
      message: 'Welcome to DORMEX Interactive Demo Session.',
      expires_at: session.expires_at,
    });
  });

  // Generate WebAuthn Authentication Challenge: POST /api/demo/auth/options
  app.post('/api/demo/auth/options', async (req: any, reply) => {
    try {
      const hostname = req.hostname || 'localhost';
      const optionsResult = await deviceAuthService.generateAuthenticationOptionsForDemo(hostname);
      return reply.send(optionsResult);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Failed to generate authentication options' });
    }
  });

  // Verify WebAuthn Assertion & Issue Short-Lived Demo Session: POST /api/demo/auth/verify
  app.post('/api/demo/auth/verify', async (req: any, reply) => {
    try {
      const { challengeToken, response } = req.body || {};
      if (!challengeToken || !response) {
        return reply.code(400).send({ error: 'CHALLENGE_AND_RESPONSE_REQUIRED' });
      }

      const expectedOrigin = deviceAuthService.getExpectedOrigin(req);
      const hostname = req.hostname || 'localhost';

      const authResult = await deviceAuthService.verifyAndAuthenticateDemo({
        challengeToken,
        response,
        expectedOrigin,
        hostname,
      });

      // Set secure HttpOnly demo session cookie (15 minutes)
      reply.setCookie('demo_session', authResult.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60, // 15 minutes
      });

      return reply.send({
        success: true,
        sessionToken: authResult.sessionToken,
        slot_id: authResult.slot_id,
        device_label: authResult.device_label,
        expires_at: authResult.expires_at,
      });
    } catch (err: any) {
      return reply.code(401).send({ error: err.message || 'WebAuthn assertion verification failed' });
    }
  });

  // Terminate Demo Session: POST /api/demo/auth/logout
  app.post('/api/demo/auth/logout', async (req: any, reply) => {
    const token = req.cookies?.demo_session;
    deviceAuthService.invalidateDemoSession(token);
    reply.clearCookie('demo_session', { path: '/' });
    return reply.send({ success: true, message: 'Demo session terminated' });
  });

  // =========================================================================
  // Device Administration Endpoints (Restricted to SUPER_ADMIN)
  // =========================================================================

  // List all predefined device slots: GET /api/admin/devices/slots
  app.get('/api/admin/devices/slots', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Requires SUPER_ADMIN privileges' });
      }

      const slots = await deviceAuthService.getDeviceSlots();
      return reply.send({ slots });
    } catch (err: any) {
      return reply.code(err.message?.startsWith('UNAUTHORIZED') ? 401 : 403).send({ error: err.message });
    }
  });

  // Generate WebAuthn Registration Options for a Slot: POST /api/admin/devices/slots/:id/register-options
  app.post('/api/admin/devices/slots/:id/register-options', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Requires SUPER_ADMIN privileges' });
      }

      const slot_id = req.params.id as 'SLOT_01' | 'SLOT_02' | 'SLOT_03';
      const hostname = req.hostname || 'localhost';

      const regOptions = await deviceAuthService.generateRegistrationOptionsForSlot({
        slot_id,
        adminUserId: actor.id,
        hostname,
      });

      return reply.send(regOptions);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Failed to generate registration options' });
    }
  });

  // Verify and Commit Device Registration: POST /api/admin/devices/slots/:id/register-verify
  app.post('/api/admin/devices/slots/:id/register-verify', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Requires SUPER_ADMIN privileges' });
      }

      const slot_id = req.params.id as 'SLOT_01' | 'SLOT_02' | 'SLOT_03';
      const { challengeToken, response } = req.body || {};
      if (!challengeToken || !response) {
        return reply.code(400).send({ error: 'CHALLENGE_AND_RESPONSE_REQUIRED' });
      }

      const expectedOrigin = deviceAuthService.getExpectedOrigin(req);
      const hostname = req.hostname || 'localhost';

      const result = await deviceAuthService.verifyAndSaveRegistration({
        slot_id,
        challengeToken,
        response,
        expectedOrigin,
        hostname,
        adminUserId: actor.id,
      });

      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Registration verification failed' });
    }
  });

  // Revoke Device Registration: POST /api/admin/devices/slots/:id/revoke
  app.post('/api/admin/devices/slots/:id/revoke', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Requires SUPER_ADMIN privileges' });
      }

      const slot_id = req.params.id as 'SLOT_01' | 'SLOT_02' | 'SLOT_03';
      const { reason } = req.body || {};

      const result = await deviceAuthService.revokeDeviceSlot({
        slot_id,
        adminUserId: actor.id,
        reason,
      });

      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Revocation failed' });
    }
  });

  // Reset Revoked Slot for Replacement: POST /api/admin/devices/slots/:id/reset
  app.post('/api/admin/devices/slots/:id/reset', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Requires SUPER_ADMIN privileges' });
      }

      const slot_id = req.params.id as 'SLOT_01' | 'SLOT_02' | 'SLOT_03';

      const result = await deviceAuthService.resetDeviceSlotForReplacement({
        slot_id,
        adminUserId: actor.id,
      });

      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Reset failed' });
    }
  });

  // ============================================================================
  // GOVERNANCE HIERARCHY & ACTION ENDPOINTS (Stage 2)
  // ============================================================================

  // List governance actions: GET /api/governance/actions
  app.get('/api/governance/actions', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const buildingId = req.query?.building_id as string | undefined;

      const actions = await governanceService.listActions(actor, buildingId);
      return reply.send({ actions });
    } catch (err: any) {
      const status = err.message?.startsWith('UNAUTHORIZED') ? 401 : err.message?.includes('CONFLICT') ? 403 : 400;
      return reply.code(status).send({ error: err.message });
    }
  });

  // Submit governance action: POST /api/governance/actions
  app.post('/api/governance/actions', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const { action_type, target_user_id, building_id, reason, details } = (req.body || {}) as any;

      if (!action_type || !reason) {
        return reply.code(400).send({ error: 'MANDATORY_FIELDS: action_type and reason are required' });
      }

      const actionId = await governanceService.submitAction({
        actor,
        actionType: action_type,
        targetUserId: target_user_id,
        buildingId: building_id,
        reason,
        details,
      });

      return reply.code(201).send({ success: true, action_id: actionId });
    } catch (err: any) {
      const status = err.message?.startsWith('UNAUTHORIZED') ? 401 : err.message?.includes('CONFLICT') ? 403 : 400;
      return reply.code(status).send({ error: err.message });
    }
  });

  // Review governance action: POST /api/governance/actions/:id/review
  app.post('/api/governance/actions/:id/review', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const actionId = req.params.id;
      const { decision, review_notes } = (req.body || {}) as any;

      if (!decision || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
        return reply.code(400).send({ error: 'INVALID_DECISION: decision must be APPROVED or REJECTED' });
      }

      await governanceService.reviewAction({
        actor,
        actionId,
        decision,
        reviewNotes: review_notes || '',
      });

      return reply.send({ success: true, action_id: actionId, status: decision });
    } catch (err: any) {
      const status = err.message?.startsWith('UNAUTHORIZED')
        ? 401
        : err.message?.includes('CONFLICT') || err.message?.includes('HIERARCHY_VIOLATION')
        ? 403
        : 400;
      return reply.code(status).send({ error: err.message });
    }
  });

  // Appoint Warden: POST /api/governance/wardens
  app.post('/api/governance/wardens', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Only Chief Warden (SUPER_ADMIN) can appoint Wardens' });
      }

      const { user_id, building_id, reason } = (req.body || {}) as any;
      if (!user_id || !building_id || !reason) {
        return reply.code(400).send({ error: 'MANDATORY_FIELDS: user_id, building_id, and reason are required' });
      }

      const apptId = await governanceService.appointWarden({
        userId: user_id,
        buildingId: building_id,
        appointedBy: actor.id,
        reason,
      });

      return reply.code(201).send({ success: true, appointment_id: apptId });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Appoint Deputy Warden: POST /api/governance/deputies
  app.post('/api/governance/deputies', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Only Chief Warden (SUPER_ADMIN) can appoint Deputy Wardens' });
      }

      const { user_id, building_id, supervisor_warden_appt_id, reason } = (req.body || {}) as any;
      if (!user_id || !building_id || !supervisor_warden_appt_id || !reason) {
        return reply.code(400).send({ error: 'MANDATORY_FIELDS: user_id, building_id, supervisor_warden_appt_id, and reason are required' });
      }

      const apptId = await governanceService.appointDeputy({
        userId: user_id,
        buildingId: building_id,
        supervisorWardenApptId: supervisor_warden_appt_id,
        appointedBy: actor.id,
        reason,
      });

      return reply.code(201).send({ success: true, appointment_id: apptId });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Revoke Warden: POST /api/governance/wardens/:id/revoke
  app.post('/api/governance/wardens/:id/revoke', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Only Chief Warden (SUPER_ADMIN) can revoke Wardens' });
      }

      const appointmentId = req.params.id;
      const { reason } = (req.body || {}) as any;
      if (!reason) {
        return reply.code(400).send({ error: 'MANDATORY_FIELDS: reason is required' });
      }

      await governanceService.revokeWarden({
        appointmentId,
        revokedBy: actor.id,
        reason,
      });

      return reply.send({ success: true, appointment_id: appointmentId, status: 'REVOKED' });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Revoke Deputy: POST /api/governance/deputies/:id/revoke
  app.post('/api/governance/deputies/:id/revoke', async (req: any, reply) => {
    try {
      const actor = await extractActor(req);
      const appointmentId = req.params.id;
      const { reason } = (req.body || {}) as any;
      if (!reason) {
        return reply.code(400).send({ error: 'MANDATORY_FIELDS: reason is required' });
      }

      // Chief Warden (SUPER_ADMIN) or Supervising Warden for their building can revoke Deputy
      if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'WARDEN') {
        return reply.code(403).send({ error: 'FORBIDDEN: Only Chief Warden or Supervising Warden can revoke Deputy' });
      }

      await governanceService.revokeDeputy({
        appointmentId,
        revokedBy: actor.id,
        reason,
      });

      return reply.send({ success: true, appointment_id: appointmentId, status: 'REVOKED' });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  return app;
}
