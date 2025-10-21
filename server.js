const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const path = require('path');
const fs = require('fs');
const yaml = require('yaml');

const Database = require('./database');
const PterodactylAPI = require('./pterodactyl');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');

// Load configuration
const configPath = path.join(__dirname, 'config.yml');
if (!fs.existsSync(configPath)) {
    console.error('❌ config.yml not found! Please create it from the template.');
    process.exit(1);
}

const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Express
const app = express();

// Initialize Database
const db = new Database(config.database.path);

// Initialize Pterodactyl API
const pterodactyl = new PterodactylAPI(
    config.pterodactyl.url, 
    config.pterodactyl.apiKey,
    config.pterodactyl.clientKey
);

// Make db and pterodactyl available to routes
app.locals.db = db;
app.locals.pterodactyl = pterodactyl;
app.locals.config = config;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.security.rateLimitWindowMs,
    max: config.security.rateLimitMaxRequests,
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Create sessions directory if it doesn't exist
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
}

// Session configuration
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.sqlite',
        dir: sessionsDir
    }),
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: config.security.sessionMaxAge,
        sameSite: 'strict'
    }
}));

// CSRF protection
const csrfProtection = csurf({ cookie: true });
app.use(csrfProtection);

// Make CSRF token and branding available to all views
app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    res.locals.brandName = config.branding?.name || 'Cosmica';
    res.locals.user = req.session.userId ? {
        id: req.session.userId,
        email: req.session.userEmail,
        role: req.session.role
    } : null;
    next();
});

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);

// Home route
app.get('/', (req, res) => {
    if (req.session.userId && req.session.twoFAVerified) {
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.',
        brandName: config.branding.name,
        user: req.session.userId ? true : false
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).render('error', {
            title: 'Invalid Request',
            message: 'Invalid security token. Please try again.',
            brandName: config.branding.name,
            user: req.session.userId ? true : false
        });
    }
    
    res.status(500).render('error', {
        title: 'Server Error',
        message: 'An unexpected error occurred. Please try again later.',
        brandName: config.branding.name,
        user: req.session.userId ? true : false
    });
});

// Initialize database and start server
async function start() {
    try {
        console.log('🚀 Starting Cosmica Dashboard...');
        console.log('   Developed by Danish - https://danishfolio.cc\n');
        
        // Initialize database
        await db.initialize();
        
        // Create admin user
        const adminCreated = await db.createAdminUser(config.admin.email, config.admin.password);
        
        // Test Pterodactyl connection
        console.log('🔗 Testing Pterodactyl connection...');
        const testResult = await pterodactyl.testConnection();
        if (testResult.success) {
            console.log('✓ Pterodactyl panel connected successfully');
            
            // Sync admin user with Pterodactyl
            const adminUser = await db.getUserByEmail(config.admin.email);
            if (adminUser && !adminUser.pterodactyl_id) {
                console.log('🔄 Syncing admin user with Pterodactyl...');
                
                // Check if user exists in Pterodactyl
                const pteroCheck = await pterodactyl.getUserByEmail(config.admin.email);
                
                if (pteroCheck.success) {
                    // User exists, link the account
                    await db.updatePterodactylId(adminUser.id, pteroCheck.user.id);
                    console.log(`✓ Linked admin account to Pterodactyl user ID: ${pteroCheck.user.id}`);
                } else {
                    // User doesn't exist, create it
                    const createResult = await pterodactyl.createUser(
                        config.admin.email,
                        config.admin.password,
                        'Admin',
                        'User'
                    );
                    
                    if (createResult.success) {
                        await db.updatePterodactylId(adminUser.id, createResult.userId);
                        console.log(`✓ Created Pterodactyl user for admin (ID: ${createResult.userId})`);
                    } else {
                        console.warn('⚠ Could not create Pterodactyl user for admin:', createResult.error);
                    }
                }
            }
        } else {
            console.warn('⚠ Warning: Could not connect to Pterodactyl panel');
            console.warn('  Please check your config.yml settings');
        }
        
        // Start server
        const PORT = config.server.port || 3000;
        app.listen(PORT, () => {
            console.log(`\n✓ Server running on http://localhost:${PORT}`);
            console.log(`✓ Admin email: ${config.admin.email}`);
            console.log('\n📝 Remember to set up 2FA on first login!\n');
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    db.close();
    process.exit(0);
});

start();
