const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { body, validationResult } = require('express-validator');
const { redirectIfAuthenticated, requireAuth } = require('../middleware/auth');

// Login page
router.get('/login', redirectIfAuthenticated, (req, res) => {
    res.render('login', {
        title: 'Login',
        error: null
    });
});

// Login handler
router.post('/login', redirectIfAuthenticated, [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('login', {
            title: 'Login',
            error: errors.array()[0].msg
        });
    }

    const { email, password } = req.body;
    const db = req.app.locals.db;

    try {
        const user = await db.getUserByEmail(email);
        
        if (!user) {
            return res.render('login', {
                title: 'Login',
                error: 'Invalid email or password'
            });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.render('login', {
                title: 'Login',
                error: 'Invalid email or password'
            });
        }

        // Set session data
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.role = user.role;
        req.session.twoFAVerified = false;

        // Check if 2FA is enabled
        if (user.twofa_enabled) {
            return res.redirect('/verify-2fa');
        } else {
            // First time login - must set up 2FA
            return res.redirect('/setup-2fa');
        }

    } catch (error) {
        console.error('Login error:', error);
        res.render('login', {
            title: 'Login',
            error: 'An error occurred. Please try again.'
        });
    }
});

// Register page
router.get('/register', redirectIfAuthenticated, (req, res) => {
    res.render('register', {
        title: 'Register',
        error: null
    });
});

// Register handler
router.post('/register', redirectIfAuthenticated, [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
    body('password')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must contain uppercase, lowercase, number and special character'),
    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Passwords do not match');
        }
        return true;
    })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('register', {
            title: 'Register',
            error: errors.array()[0].msg
        });
    }

    const { email, password } = req.body;
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;

    try {
        // Check if user already exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.render('register', {
                title: 'Register',
                error: 'An account with this email already exists'
            });
        }

        // Create user in Pterodactyl
        const pteroResult = await pterodactyl.createUser(email, password);
        
        let pterodactylId = null;
        if (pteroResult.success) {
            pterodactylId = pteroResult.userId;
            console.log(`✓ Created Pterodactyl user: ${email} (ID: ${pterodactylId})`);
        } else {
            console.warn(`⚠ Could not create Pterodactyl user: ${pteroResult.error}`);
            // Continue anyway - user can still use dashboard
        }

        // Get bonus settings
        const bonusEnabled = await db.getSetting('bonus_enabled');
        const bonusAmount = await db.getSetting('bonus_amount');
        const bonusCredits = (bonusEnabled === 'true' && bonusAmount) ? parseFloat(bonusAmount) : 0;

        // Create user in database with bonus credits
        const userId = await db.createUser(email, password, pterodactylId, bonusCredits);
        
        if (bonusCredits > 0) {
            console.log(`✓ Awarded ${bonusCredits} bonus credits to new user`);
        }

        // Set session
        req.session.userId = userId;
        req.session.userEmail = email;
        req.session.role = 'user';
        req.session.twoFAVerified = false;

        // Redirect to 2FA setup
        res.redirect('/setup-2fa');

    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', {
            title: 'Register',
            error: 'An error occurred during registration. Please try again.'
        });
    }
});

// 2FA Setup page
router.get('/setup-2fa', requireAuth, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (user.twofa_enabled) {
            return res.redirect('/verify-2fa');
        }

        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `Cosmica (${user.email})`,
            issuer: 'Cosmica Dashboard'
        });

        // Store secret temporarily in session
        req.session.tempTwoFASecret = secret.base32;

        // Generate QR code
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        res.render('setup-2fa', {
            title: 'Setup 2FA',
            qrCode: qrCodeUrl,
            secret: secret.base32,
            error: null
        });

    } catch (error) {
        console.error('2FA setup error:', error);
        res.redirect('/dashboard');
    }
});

// 2FA Setup verification
router.post('/setup-2fa', requireAuth, [
    body('token').isLength({ min: 6, max: 6 }).withMessage('Invalid token')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('setup-2fa', {
            title: 'Setup 2FA',
            qrCode: null,
            secret: req.session.tempTwoFASecret,
            error: 'Invalid token format'
        });
    }

    const { token } = req.body;
    const secret = req.session.tempTwoFASecret;
    const db = req.app.locals.db;

    if (!secret) {
        return res.redirect('/setup-2fa');
    }

    try {
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token,
            window: 2
        });

        if (!verified) {
            const qrCodeUrl = await qrcode.toDataURL(
                speakeasy.generateSecret({ name: 'Cosmica' }).otpauth_url
            );
            return res.render('setup-2fa', {
                title: 'Setup 2FA',
                qrCode: qrCodeUrl,
                secret: secret,
                error: 'Invalid token. Please try again.'
            });
        }

        // Save 2FA secret to database
        await db.updateUser2FA(req.session.userId, secret, true);

        // Mark 2FA as verified in session
        req.session.twoFAVerified = true;
        delete req.session.tempTwoFASecret;

        res.redirect('/dashboard');

    } catch (error) {
        console.error('2FA verification error:', error);
        res.redirect('/setup-2fa');
    }
});

// 2FA Verification page
router.get('/verify-2fa', requireAuth, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (!user.twofa_enabled) {
            return res.redirect('/setup-2fa');
        }

        if (req.session.twoFAVerified) {
            return res.redirect('/dashboard');
        }

        res.render('verify-2fa', {
            title: 'Verify 2FA',
            error: null
        });

    } catch (error) {
        console.error('2FA verify page error:', error);
        res.redirect('/login');
    }
});

// 2FA Verification handler
router.post('/verify-2fa', requireAuth, [
    body('token').isLength({ min: 6, max: 6 }).withMessage('Invalid token')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('verify-2fa', {
            title: 'Verify 2FA',
            error: 'Invalid token format'
        });
    }

    const { token } = req.body;
    const db = req.app.locals.db;

    try {
        const user = await db.getUserById(req.session.userId);

        if (!user || !user.twofa_secret) {
            return res.redirect('/setup-2fa');
        }

        const verified = speakeasy.totp.verify({
            secret: user.twofa_secret,
            encoding: 'base32',
            token: token,
            window: 2
        });

        if (!verified) {
            return res.render('verify-2fa', {
                title: 'Verify 2FA',
                error: 'Invalid token. Please try again.'
            });
        }

        // Mark 2FA as verified
        req.session.twoFAVerified = true;
        res.redirect('/dashboard');

    } catch (error) {
        console.error('2FA verification error:', error);
        res.render('verify-2fa', {
            title: 'Verify 2FA',
            error: 'An error occurred. Please try again.'
        });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/login');
    });
});

module.exports = router;
