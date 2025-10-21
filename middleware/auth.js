function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/login');
}

function require2FA(req, res, next) {
    if (req.session && req.session.userId && req.session.twoFAVerified) {
        return next();
    }
    
    if (req.session && req.session.userId && !req.session.twoFAVerified) {
        return res.redirect('/verify-2fa');
    }
    
    res.redirect('/login');
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.userId && req.session.twoFAVerified && req.session.role === 'admin') {
        return next();
    }
    res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: req.session.userId ? { role: req.session.role } : null
    });
}

function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.userId && req.session.twoFAVerified) {
        return res.redirect('/dashboard');
    }
    next();
}

module.exports = {
    requireAuth,
    require2FA,
    requireAdmin,
    redirectIfAuthenticated
};
