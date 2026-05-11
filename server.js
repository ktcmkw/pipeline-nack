require('dotenv').config();
const express          = require('express');
const http             = require('http');
const { Server }       = require('socket.io');
const session          = require('express-session');
const connectPgSimple  = require('connect-pg-simple');
const { pool }         = require('./db/db');
const { loadUser }     = require('./middleware/requireAuth');
const { requireAuth }  = require('./middleware/requireAuth');
const authRoutes       = require('./routes/auth');
const projectRoutes    = require('./routes/projects');
const userRoutes       = require('./routes/users');
const activityRoutes   = require('./routes/activity');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.set('io', io);

// ─── Trust Render's reverse proxy (CRITICAL for secure cookies) ─
app.set('trust proxy', 1);

// ─── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only on Render
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
}));

// Load user from session into req.user on every request
app.use(loadUser);

// ─── Guard protected HTML pages before static serves them ─────
// express.static would serve index.html/admin.html without auth otherwise
app.use((req, res, next) => {
  if (req.path === '/index.html') {
    if (!req.user) return res.redirect('/login.html');
    return next();
  }
  if (req.path === '/admin.html') {
    if (!req.user) return res.redirect('/login.html');
    if (req.user.role !== 'admin') return res.redirect('/');
    return next();
  }
  next();
});

// ─── Static files ─────────────────────────────────────────────
app.use(express.static('public'));

// ─── Routes ───────────────────────────────────────────────────
app.use('/auth',         authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/activity', activityRoutes);

// Root → dashboard (requires auth)
app.get('/', requireAuth, (req, res) =>
  res.sendFile(__dirname + '/public/index.html')
);

// Admin panel (requires auth + admin role)
app.get('/admin.html', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/');
  res.sendFile(__dirname + '/public/admin.html');
});

// Health check for Render
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Socket.io ────────────────────────────────────────────────
io.on('connection', (socket) => {
  if (process.env.NODE_ENV !== 'production')
    console.log(`[socket] connected: ${socket.id}`);
  socket.on('disconnect', () => {
    if (process.env.NODE_ENV !== 'production')
      console.log(`[socket] disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (${process.env.NODE_ENV || 'development'})`);
});
