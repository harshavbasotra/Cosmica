const express = require('express');
const router = express.Router();
const { require2FA, requireAdmin } = require('../middleware/auth');

// Dashboard home
router.get('/', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (!user) {
            console.error('User not found in database');
            return res.redirect('/login');
        }
        
        console.log('Full user object:', user);
        console.log('User keys:', Object.keys(user));
        
        let servers = [];
        let totalResources = {
            cpu: 0,
            memory: 0,
            disk: 0
        };
        
        // Fetch servers from Pterodactyl if user has a linked account
        console.log('User pterodactyl_id:', user.pterodactyl_id);
        console.log('Pterodactyl API available:', !!pterodactyl);
        
        if (user.pterodactyl_id && pterodactyl) {
            try {
                console.log('Fetching servers for user:', user.pterodactyl_id);
                const serversResult = await pterodactyl.getUserServers(user.pterodactyl_id);
                console.log('Server fetch result:', serversResult);
                
                if (serversResult.success) {
                    servers = serversResult.servers;
                    console.log('Successfully fetched servers:', servers.length);
                    
                    // Calculate total allocated resources (limits)
                    for (const server of servers) {
                        totalResources.cpu += server.limits.cpu || 0;
                        totalResources.memory += server.limits.memory || 0;
                        totalResources.disk += server.limits.disk || 0;
                    }
                } else {
                    console.error('Failed to fetch servers:', serversResult.error);
                }
            } catch (err) {
                console.error('Error fetching servers:', err);
            }
        } else {
            console.log('No pterodactyl_id or API not available');
        }
        
        res.render('dashboard', {
            title: 'Dashboard',
            brandName: req.app.locals.config.branding.name,
            user: {
                id: user.id,
                email: user.email || 'user',
                role: user.role || 'user',
                pterodactylId: user.pterodactyl_id,
                credits: user.credits || 0
            },
            servers: servers,
            resources: {
                cpu: totalResources.cpu,
                memory: totalResources.memory, // Already in MB from limits
                disk: (totalResources.disk / 1024).toFixed(2) // Convert MB to GB
            },
            panelUrl: req.app.locals.config.pterodactyl.url,
            activePage: 'dashboard',
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.redirect('/login');
    }
});

// Sync servers endpoint - forces fresh fetch bypassing cache
router.post('/api/sync-servers', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (!user || !user.pterodactyl_id) {
            return res.json({ 
                success: false, 
                error: 'No Pterodactyl account linked' 
            });
        }
        
        // Force fresh fetch from Pterodactyl (bypass any caching)
        const serversResult = await pterodactyl.getUserServers(user.pterodactyl_id, true);
        
        if (!serversResult.success) {
            return res.json({ 
                success: false, 
                error: serversResult.error || 'Failed to fetch servers' 
            });
        }
        
        const servers = serversResult.servers || [];
        
        // Calculate resources
        let totalResources = {
            cpu: 0,
            memory: 0,
            disk: 0
        };
        
        for (const server of servers) {
            totalResources.cpu += server.limits.cpu || 0;
            totalResources.memory += server.limits.memory || 0;
            totalResources.disk += server.limits.disk || 0;
        }
        
        res.json({
            success: true,
            servers: servers,
            resources: {
                cpu: totalResources.cpu,
                memory: totalResources.memory,
                disk: totalResources.disk
            }
        });
        
    } catch (error) {
        console.error('Sync servers error:', error);
        res.json({ 
            success: false, 
            error: 'Server sync failed' 
        });
    }
});

// API endpoint for real-time stats
router.get('/api/stats', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    
    try {
        const user = await db.getUserById(req.session.userId);
        let servers = [];
        let totalResources = {
            cpu: 0,
            memory: 0,
            disk: 0
        };
        let serverStatuses = [];
        
        if (user.pterodactyl_id && pterodactyl) {
            const serversResult = await pterodactyl.getUserServers(user.pterodactyl_id);
            if (serversResult.success) {
                servers = serversResult.servers;
                
                // Calculate total resource usage and collect statuses
                if (pterodactyl.clientApi && servers.length > 0) {
                    for (const server of servers) {
                        try {
                            const resourcesResult = await pterodactyl.getServerResources(server.identifier);
                            if (resourcesResult.success) {
                                const res = resourcesResult.resources;
                                totalResources.cpu += res.cpu_absolute || 0;
                                totalResources.memory += res.memory_bytes || 0;
                                totalResources.disk += res.disk_bytes || 0;
                                
                                serverStatuses.push({
                                    identifier: server.identifier,
                                    status: res.state
                                });
                            }
                        } catch (err) {
                            console.log(`Could not fetch resources for ${server.identifier}`);
                        }
                    }
                }
            }
        }
        
        res.json({
            success: true,
            servers: servers.length,
            resources: {
                cpu: totalResources.cpu.toFixed(2),
                memory: (totalResources.memory / (1024 * 1024)).toFixed(0),
                disk: (totalResources.disk / (1024 * 1024 * 1024)).toFixed(2)
            },
            serverStatuses: serverStatuses
        });
    } catch (error) {
        console.error('Stats API error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Settings page
router.get('/settings', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (!user) {
            return res.redirect('/login');
        }
        
        res.render('settings', {
            title: 'Settings',
            brandName: req.app.locals.config.branding.name,
            user: {
                id: user.id,
                email: user.email || 'user',
                role: user.role || 'user',
                pterodactylId: user.pterodactyl_id,
                credits: user.credits || 0
            },
            panelUrl: req.app.locals.config.pterodactyl.url,
            csrfToken: req.csrfToken(),
            activePage: 'settings'
        });
    } catch (error) {
        console.error('Settings error:', error);
        res.redirect('/dashboard');
    }
});

// Update email
router.post('/settings/email', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    const { email, password } = req.body;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        // Verify password
        const bcrypt = require('bcrypt');
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.render('settings', {
                title: 'Settings',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, pterodactylId: user.pterodactyl_id, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'Invalid password',
                activePage: 'settings'
            });
        }
        
        // Update in database
        await db.updateUserEmail(user.id, email);
        
        // Update in Pterodactyl if linked
        if (user.pterodactyl_id && pterodactyl) {
            await pterodactyl.updateUser(user.pterodactyl_id, { email });
        }
        
        res.render('settings', {
            title: 'Settings',
            brandName: req.app.locals.config.branding.name,
            user: { id: user.id, email: email, role: user.role, pterodactylId: user.pterodactyl_id, credits: user.credits || 0 },
            panelUrl: req.app.locals.config.pterodactyl.url,
            csrfToken: req.csrfToken(),
            success: 'Email updated successfully',
            activePage: 'settings'
        });
    } catch (error) {
        console.error('Email update error:', error);
        res.redirect('/dashboard/settings');
    }
});

// Update password
router.post('/settings/password', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        // Verify current password
        const bcrypt = require('bcrypt');
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        
        if (!validPassword) {
            return res.render('settings', {
                title: 'Settings',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, pterodactylId: user.pterodactyl_id, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'Invalid current password',
                activePage: 'settings'
            });
        }
        
        // Check if passwords match
        if (newPassword !== confirmPassword) {
            return res.render('settings', {
                title: 'Settings',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, pterodactylId: user.pterodactyl_id, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'Passwords do not match',
                activePage: 'settings'
            });
        }
        
        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Update in database
        await db.updateUserPassword(user.id, hashedPassword);
        
        // Update in Pterodactyl if linked
        if (user.pterodactyl_id && pterodactyl) {
            await pterodactyl.updateUserPassword(user.pterodactyl_id, newPassword);
        }
        
        res.render('settings', {
            title: 'Settings',
            brandName: req.app.locals.config.branding.name,
            user: { id: user.id, email: user.email, role: user.role, pterodactylId: user.pterodactyl_id, credits: user.credits || 0 },
            panelUrl: req.app.locals.config.pterodactyl.url,
            csrfToken: req.csrfToken(),
            success: 'Password updated successfully',
            activePage: 'settings'
        });
    } catch (error) {
        console.error('Password update error:', error);
        res.redirect('/dashboard/settings');
    }
});

// Admin panel
router.get('/admin', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (!user) {
            return res.redirect('/login');
        }
        
        const allUsers = await db.getAllUsers();
        
        // Get total servers count (only count from users with pterodactyl_id)
        let totalServers = 0;
        const usersWithServers = allUsers.filter(u => u.pterodactyl_id);
        
        // Limit concurrent API calls to prevent rate limiting
        const chunkSize = 3;
        for (let i = 0; i < usersWithServers.length; i += chunkSize) {
            const chunk = usersWithServers.slice(i, i + chunkSize);
            const results = await Promise.allSettled(
                chunk.map(u => pterodactyl ? pterodactyl.getUserServers(u.pterodactyl_id) : null)
            );
            
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value?.success) {
                    totalServers += result.value.servers.length;
                }
            });
            
            // Small delay between chunks to avoid rate limiting
            if (i + chunkSize < usersWithServers.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Get gift cards
        const giftCards = await db.getAllGiftCards();
        
        // Get all server plans
        const plans = await db.getAllPlans();
        
        // Get bonus settings
        const bonusEnabled = await db.getSetting('bonus_enabled');
        const bonusAmount = await db.getSetting('bonus_amount');
        
        res.render('admin', {
            title: 'Admin Panel',
            brandName: req.app.locals.config.branding.name,
            user: {
                id: user.id,
                email: user.email || 'admin',
                role: user.role || 'admin',
                credits: user.credits || 0
            },
            panelUrl: req.app.locals.config.pterodactyl.url,
            stats: {
                totalUsers: allUsers.length,
                totalServers: totalServers
            },
            users: allUsers,
            giftCards: giftCards,
            plans: plans,
            bonusSettings: {
                enabled: bonusEnabled === 'true',
                amount: parseFloat(bonusAmount || 0)
            },
            csrfToken: req.csrfToken(),
            activePage: 'admin'
        });
    } catch (error) {
        console.error('Admin panel error:', error);
        res.redirect('/dashboard');
    }
});

// Admin: Update bonus settings
router.post('/admin/settings/bonus', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const { enabled, amount } = req.body;
    
    try {
        await db.setSetting('bonus_enabled', enabled === 'on' ? 'true' : 'false');
        await db.setSetting('bonus_amount', amount || '0');
        res.redirect('/dashboard/admin');
    } catch (error) {
        console.error('Bonus settings error:', error);
        res.redirect('/dashboard/admin');
    }
});

// Admin: Create gift card
router.post('/admin/gift-cards/create', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const { code, credits, max_uses, per_user_limit } = req.body;
    
    try {
        await db.createGiftCard(
            code.toUpperCase(),
            parseFloat(credits),
            parseInt(max_uses),
            parseInt(per_user_limit)
        );
        res.redirect('/dashboard/admin');
    } catch (error) {
        console.error('Create gift card error:', error);
        res.redirect('/dashboard/admin');
    }
});

// Admin: Toggle gift card
router.post('/admin/gift-cards/:id/toggle', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;
    const { enabled } = req.body;
    
    try {
        await db.updateGiftCard(id, { enabled: enabled ? 1 : 0 });
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle gift card error:', error);
        res.status(500).json({ error: 'Failed to toggle gift card' });
    }
});

// Admin: Delete gift card
router.post('/admin/gift-cards/:id/delete', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;

    try {
        await db.deleteGiftCard(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete gift card error:', error);
        res.status(500).json({ error: 'Failed to delete gift card' });
    }
});

// Pricing/Features comparison page
router.get('/pricing', require2FA, async (req, res) => {
    const db = req.app.locals.db;

    try {
        const user = await db.getUserById(req.session.userId);
        if (!user) {
            return res.redirect('/login');
        }

        res.render('pricing', {
            title: 'Feature Comparison',
            brandName: req.app.locals.config.branding.name,
            user: {
                id: user.id,
                email: user.email || 'user',
                role: user.role || 'user',
                credits: user.credits || 0
            },
            panelUrl: req.app.locals.config.pterodactyl.url,
            csrfToken: req.csrfToken(),
            activePage: 'pricing'
        });
    } catch (error) {
        console.error('Pricing page error:', error);
        res.redirect('/dashboard');
    }
});

// Redeem gift card page
router.get('/redeem', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const user = await db.getUserById(req.session.userId);
        if (!user) {
            return res.redirect('/login');
        }
        
        res.render('redeem', {
            title: 'Redeem Gift Card',
            brandName: req.app.locals.config.branding.name,
            user: {
                id: user.id,
                email: user.email || 'user',
                role: user.role || 'user',
                credits: user.credits || 0
            },
            panelUrl: req.app.locals.config.pterodactyl.url,
            csrfToken: req.csrfToken(),
            activePage: 'redeem'
        });
    } catch (error) {
        console.error('Redeem page error:', error);
        res.redirect('/dashboard');
    }
});

// Redeem gift card
router.post('/redeem', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const { code } = req.body;
    
    try {
        const user = await db.getUserById(req.session.userId);
        if (!user) {
            return res.redirect('/login');
        }
        
        // Get gift card
        const giftCard = await db.getGiftCard(code.toUpperCase());
        
        if (!giftCard) {
            return res.render('redeem', {
                title: 'Redeem Gift Card',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'Invalid gift card code',
                activePage: 'redeem'
            });
        }
        
        // Check if enabled
        if (!giftCard.enabled) {
            return res.render('redeem', {
                title: 'Redeem Gift Card',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'This gift card is no longer active',
                activePage: 'redeem'
            });
        }
        
        // Check if expired
        if (giftCard.expires_at && new Date(giftCard.expires_at) < new Date()) {
            return res.render('redeem', {
                title: 'Redeem Gift Card',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'This gift card has expired',
                activePage: 'redeem'
            });
        }
        
        // Check max uses
        if (giftCard.uses >= giftCard.max_uses) {
            return res.render('redeem', {
                title: 'Redeem Gift Card',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'This gift card has reached its usage limit',
                activePage: 'redeem'
            });
        }
        
        // Check per user limit
        const userRedemptions = await db.getUserRedemptions(user.id, giftCard.id);
        if (userRedemptions >= giftCard.per_user_limit) {
            return res.render('redeem', {
                title: 'Redeem Gift Card',
                brandName: req.app.locals.config.branding.name,
                user: { id: user.id, email: user.email, role: user.role, credits: user.credits || 0 },
                panelUrl: req.app.locals.config.pterodactyl.url,
                csrfToken: req.csrfToken(),
                error: 'You have already redeemed this gift card the maximum number of times',
                activePage: 'redeem'
            });
        }
        
        // Redeem the gift card
        await db.updateUserCredits(user.id, giftCard.credits);
        await db.incrementGiftCardUses(giftCard.id);
        await db.redeemGiftCard(user.id, giftCard.id, giftCard.credits);
        
        // Get updated user
        const updatedUser = await db.getUserById(user.id);
        
        res.render('redeem', {
            title: 'Redeem Gift Card',
            brandName: req.app.locals.config.branding.name,
            user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role, credits: updatedUser.credits || 0 },
            panelUrl: req.app.locals.config.pterodactyl.url,
            csrfToken: req.csrfToken(),
            success: `Successfully redeemed $${giftCard.credits.toFixed(2)} in credits!`,
            activePage: 'redeem'
        });
    } catch (error) {
        console.error('Redeem error:', error);
        res.redirect('/dashboard/redeem');
    }
});

// ==================== USER INSTANCES ROUTES ====================

// View purchase instances page
router.get('/instances', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const user = await db.getUserById(req.session.userId);
        
        if (!user) {
            return res.redirect('/login');
        }
        
        // Get enabled plans
        const plans = await db.getEnabledPlans();
        
        res.render('instances', {
            title: 'Purchase Instance',
            brandName: req.app.locals.config.branding.name,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                credits: user.credits || 0
            },
            panelUrl: req.app.locals.config.pterodactyl.url,
            plans: plans,
            csrfToken: req.csrfToken(),
            activePage: 'instances'
        });
    } catch (error) {
        console.error('Instances page error:', error);
        res.redirect('/dashboard');
    }
});

// Purchase instance
router.post('/instances/purchase', require2FA, async (req, res) => {
    const db = req.app.locals.db;
    const pterodactyl = req.app.locals.pterodactyl;
    
    try {
        const user = await db.getUserById(req.session.userId);
        const { plan_id, server_name } = req.body;
        
        if (!user || !plan_id || !server_name) {
            return res.redirect('/dashboard/instances?error=Missing required fields');
        }
        
        // Get plan
        const plan = await db.getPlanById(plan_id);
        if (!plan || !plan.enabled) {
            return res.redirect('/dashboard/instances?error=Invalid plan');
        }
        
        // Check user credits
        if (user.credits < plan.price) {
            return res.redirect('/dashboard/instances?error=Insufficient credits');
        }
        
        // Check user limit
        if (plan.user_limit > 0) {
            const userServerCount = await db.getUserServerCount(user.id, plan_id);
            if (userServerCount >= plan.user_limit) {
                return res.redirect('/dashboard/instances?error=You have reached the maximum limit for this plan');
            }
        }
        
        // Check stock limit
        if (plan.stock_limit > 0 && plan.stock_used >= plan.stock_limit) {
            return res.redirect('/dashboard/instances?error=This plan is out of stock');
        }
        
        // Ensure user has Pterodactyl account
        if (!user.pterodactyl_id) {
            // Create Pterodactyl user
            const pteroUser = await pterodactyl.createUser(user.email, Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
            if (!pteroUser.success) {
                return res.redirect('/dashboard/instances?error=Failed to create panel account');
            }
            await db.linkPterodactylUser(user.id, pteroUser.data.id);
            user.pterodactyl_id = pteroUser.data.id;
        }
        
        // Parse environment variables
        let environment = {};
        if (plan.environment_variables) {
            try {
                environment = JSON.parse(plan.environment_variables);
            } catch (e) {
                console.error('Failed to parse environment variables:', e);
            }
        }
        
        // Parse location IDs
        const locationIds = plan.location_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        
        // Create server
        const serverData = {
            name: server_name,
            user: user.pterodactyl_id,
            egg: plan.egg_id,
            docker_image: plan.docker_image || 'ghcr.io/pterodactyl/yolks:java_17',
            startup: plan.startup_command || undefined,
            environment: environment,
            limits: {
                memory: plan.ram,
                disk: plan.disk,
                cpu: plan.cpu,
                swap: plan.swap,
                io: plan.io
            },
            feature_limits: {
                databases: plan.databases,
                backups: plan.backups,
                allocations: plan.allocations
            },
            deploy: {
                locations: locationIds,
                dedicated_ip: false,
                port_range: []
            }
        };
        
        const serverResult = await pterodactyl.createServer(serverData);
        
        if (!serverResult.success) {
            console.error('Server creation failed:', serverResult.error);
            return res.redirect('/dashboard/instances?error=' + encodeURIComponent('Server creation failed: ' + serverResult.error));
        }
        
        // Deduct credits
        await db.updateUserCredits(user.id, -plan.price);
        
        // Increment stock
        await db.incrementPlanStock(plan_id);
        
        // Save server to database
        await db.createUserServer({
            user_id: user.id,
            plan_id: plan_id,
            pterodactyl_server_id: serverResult.data.id,
            server_name: server_name,
            server_identifier: serverResult.data.identifier,
            status: 'active'
        });
        
        res.redirect('/dashboard?success=' + encodeURIComponent(`Server "${server_name}" created successfully!`));
    } catch (error) {
        console.error('Purchase error:', error);
        res.redirect('/dashboard/instances?error=An error occurred during purchase');
    }
});

// ==================== SERVER PLANS ROUTES ====================

// Create server plan
router.post('/admin/plans/create', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const { name, description, price, billing_cycle, cpu, ram, disk, swap, io, databases, backups, allocations,
                egg_id, location_ids, docker_image, startup_command, environment_variables,
                user_limit, stock_limit, enabled, category, sort_order } = req.body;
        
        await db.createPlan({
            name,
            description,
            price: parseFloat(price),
            billing_cycle: billing_cycle || 'monthly',
            cpu: parseInt(cpu),
            ram: parseInt(ram),
            disk: parseInt(disk),
            swap: parseInt(swap || 0),
            io: parseInt(io || 500),
            databases: parseInt(databases || 0),
            backups: parseInt(backups || 0),
            allocations: parseInt(allocations || 1),
            egg_id: parseInt(egg_id),
            location_ids: location_ids,
            docker_image: docker_image || null,
            startup_command: startup_command || null,
            environment_variables: environment_variables || null,
            user_limit: parseInt(user_limit || 0),
            stock_limit: parseInt(stock_limit || 0),
            enabled: enabled === 'on',
            category: category || 'general',
            sort_order: parseInt(sort_order || 0)
        });
        
        res.redirect('/dashboard/admin');
    } catch (error) {
        console.error('Plan creation error:', error);
        res.redirect('/dashboard/admin');
    }
});

// Delete server plan
router.post('/admin/plans/:id/delete', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        await db.deletePlan(req.params.id);
        res.redirect('/dashboard/admin');
    } catch (error) {
        console.error('Plan deletion error:', error);
        res.redirect('/dashboard/admin');
    }
});

// Update server plan
router.post('/admin/plans/:id/update', requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const { name, description, price, billing_cycle, cpu, ram, disk, swap, io, databases, backups, allocations,
                egg_id, location_ids, docker_image, startup_command, environment_variables,
                user_limit, stock_limit, enabled, category, sort_order } = req.body;
        
        await db.updatePlan(req.params.id, {
            name,
            description,
            price: parseFloat(price),
            billing_cycle: billing_cycle || 'monthly',
            cpu: parseInt(cpu),
            ram: parseInt(ram),
            disk: parseInt(disk),
            swap: parseInt(swap || 0),
            io: parseInt(io || 500),
            databases: parseInt(databases || 0),
            backups: parseInt(backups || 0),
            allocations: parseInt(allocations || 1),
            egg_id: parseInt(egg_id),
            location_ids: location_ids,
            docker_image: docker_image || null,
            startup_command: startup_command || null,
            environment_variables: environment_variables || null,
            user_limit: parseInt(user_limit || 0),
            stock_limit: parseInt(stock_limit || 0),
            enabled: enabled === 'on',
            category: category || 'general',
            sort_order: parseInt(sort_order || 0)
        });
        
        res.redirect('/dashboard/admin');
    } catch (error) {
        console.error('Plan update error:', error);
        res.redirect('/dashboard/admin');
    }
});

module.exports = router;
