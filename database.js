const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

class Database {
    constructor(dbPath) {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir) && dir !== '.') {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        this.dbPath = dbPath;
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Database connection error:', err);
                    reject(err);
                    return;
                }
                console.log('✓ Connected to SQLite database');
                
                // Now create tables
                this.createTables().then(resolve).catch(reject);
            });
        });
    }

    async createTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Users table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT UNIQUE NOT NULL,
                        password TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'user',
                        credits REAL DEFAULT 0,
                        twofa_secret TEXT,
                        twofa_enabled INTEGER DEFAULT 0,
                        pterodactyl_id INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating users table:', err);
                        reject(err);
                        return;
                    }
                });

                // Sessions table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS sessions (
                        sid TEXT PRIMARY KEY,
                        sess TEXT NOT NULL,
                        expired INTEGER NOT NULL
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating sessions table:', err);
                        reject(err);
                        return;
                    }
                });

                // Settings table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating settings table:', err);
                        reject(err);
                        return;
                    }
                });

                // Gift cards table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS gift_cards (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        code TEXT UNIQUE NOT NULL,
                        credits REAL NOT NULL,
                        max_uses INTEGER DEFAULT 1,
                        uses INTEGER DEFAULT 0,
                        per_user_limit INTEGER DEFAULT 1,
                        enabled INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating gift_cards table:', err);
                        reject(err);
                        return;
                    }
                });

                // Gift card redemptions table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS gift_card_redemptions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        gift_card_id INTEGER NOT NULL,
                        credits_received REAL NOT NULL,
                        redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id),
                        FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id)
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating gift_card_redemptions table:', err);
                        reject(err);
                        return;
                    }
                });

                // Server plans table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS server_plans (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        description TEXT,
                        price REAL NOT NULL,
                        billing_cycle TEXT DEFAULT 'monthly',
                        cpu INTEGER NOT NULL,
                        ram INTEGER NOT NULL,
                        disk INTEGER NOT NULL,
                        swap INTEGER DEFAULT 0,
                        io INTEGER DEFAULT 500,
                        databases INTEGER DEFAULT 0,
                        backups INTEGER DEFAULT 0,
                        allocations INTEGER DEFAULT 1,
                        egg_id INTEGER NOT NULL,
                        location_ids TEXT NOT NULL,
                        docker_image TEXT,
                        startup_command TEXT,
                        environment_variables TEXT,
                        user_limit INTEGER DEFAULT 0,
                        stock_limit INTEGER DEFAULT 0,
                        stock_used INTEGER DEFAULT 0,
                        enabled INTEGER DEFAULT 1,
                        category TEXT DEFAULT 'general',
                        sort_order INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating server_plans table:', err);
                        reject(err);
                        return;
                    }
                });

                // User servers table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS user_servers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        plan_id INTEGER NOT NULL,
                        pterodactyl_server_id INTEGER NOT NULL,
                        server_name TEXT NOT NULL,
                        server_identifier TEXT NOT NULL,
                        status TEXT DEFAULT 'active',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME,
                        next_billing_date DATETIME,
                        FOREIGN KEY (user_id) REFERENCES users(id),
                        FOREIGN KEY (plan_id) REFERENCES server_plans(id)
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating user_servers table:', err);
                        reject(err);
                        return;
                    }
                });

                // Create indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_redemptions_user ON gift_card_redemptions(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_plans_enabled ON server_plans(enabled)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_servers_user ON user_servers(user_id)`, (err) => {
                    if (err) {
                        console.error('Error creating indexes:', err);
                        reject(err);
                        return;
                    }
                    
                    // Migrations for existing tables
                    this.runMigrations().then(() => {
                        console.log('✓ Database tables initialized');
                        resolve();
                    }).catch(reject);
                });
            });
        });
    }

    async runMigrations() {
        return new Promise((resolve, reject) => {
            // Add billing_cycle column to server_plans if it doesn't exist
            this.db.run(`
                ALTER TABLE server_plans ADD COLUMN billing_cycle TEXT DEFAULT 'monthly'
            `, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (billing_cycle):', err);
                }
            });
            
            // Add next_billing_date column to user_servers if it doesn't exist
            this.db.run(`
                ALTER TABLE user_servers ADD COLUMN next_billing_date DATETIME
            `, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (next_billing_date):', err);
                }
                resolve();
            });
        });
    }

    async createAdminUser(email, password) {
        return new Promise(async (resolve, reject) => {
            try {
                // Check if admin exists
                this.db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (row) {
                        console.log('✓ Admin user already exists');
                        resolve(false);
                        return;
                    }

                    // Create admin user
                    const hashedPassword = await bcrypt.hash(password, 12);
                    this.db.run(
                        'INSERT INTO users (email, password, role, twofa_enabled) VALUES (?, ?, ?, ?)',
                        [email, hashedPassword, 'admin', 0],
                        function(err) {
                            if (err) {
                                reject(err);
                                return;
                            }
                            console.log('✓ Admin user created successfully');
                            resolve(true);
                        }
                    );
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async getUserByEmail(email) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getUserById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getAllUsers() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, email, role, credits, pterodactyl_id, created_at FROM users', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async updateUserEmail(id, email) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE users SET email = ? WHERE id = ?', [email, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async updateUserPassword(id, password) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE users SET password = ? WHERE id = ?', [password, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async updateUserCredits(id, credits) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE users SET credits = credits + ? WHERE id = ?', [credits, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async setUserCredits(id, credits) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE users SET credits = ? WHERE id = ?', [credits, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // Settings methods
    async getSetting(key) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.value : null);
            });
        });
    }

    async setSetting(key, value) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                [key, value],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    }

    // Gift card methods
    async createGiftCard(code, credits, maxUses = 1, perUserLimit = 1, expiresAt = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO gift_cards (code, credits, max_uses, per_user_limit, expires_at) VALUES (?, ?, ?, ?, ?)',
                [code, credits, maxUses, perUserLimit, expiresAt],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    }

    async getGiftCard(code) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM gift_cards WHERE code = ?', [code], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getAllGiftCards() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM gift_cards ORDER BY created_at DESC', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async updateGiftCard(id, data) {
        return new Promise((resolve, reject) => {
            const fields = [];
            const values = [];
            
            if (data.credits !== undefined) {
                fields.push('credits = ?');
                values.push(data.credits);
            }
            if (data.max_uses !== undefined) {
                fields.push('max_uses = ?');
                values.push(data.max_uses);
            }
            if (data.per_user_limit !== undefined) {
                fields.push('per_user_limit = ?');
                values.push(data.per_user_limit);
            }
            if (data.enabled !== undefined) {
                fields.push('enabled = ?');
                values.push(data.enabled);
            }
            if (data.expires_at !== undefined) {
                fields.push('expires_at = ?');
                values.push(data.expires_at);
            }
            
            values.push(id);
            
            this.db.run(
                `UPDATE gift_cards SET ${fields.join(', ')} WHERE id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    }

    async deleteGiftCard(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM gift_cards WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async incrementGiftCardUses(id) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE gift_cards SET uses = uses + 1 WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async getUserRedemptions(userId, giftCardId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT COUNT(*) as count FROM gift_card_redemptions WHERE user_id = ? AND gift_card_id = ?',
                [userId, giftCardId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.count : 0);
                }
            );
        });
    }

    async redeemGiftCard(userId, giftCardId, credits) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO gift_card_redemptions (user_id, gift_card_id, credits_received) VALUES (?, ?, ?)',
                [userId, giftCardId, credits],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    }

    async createUser(email, password, pterodactylId = null, bonusCredits = 0) {
        return new Promise(async (resolve, reject) => {
            try {
                const hashedPassword = await bcrypt.hash(password, 12);
                this.db.run(
                    'INSERT INTO users (email, password, role, pterodactyl_id, twofa_enabled, credits) VALUES (?, ?, ?, ?, ?, ?)',
                    [email, hashedPassword, 'user', pterodactylId, 0, bonusCredits],
                    function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(this.lastID);
                    }
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    async updateUser2FA(userId, secret, enabled) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE users SET twofa_secret = ?, twofa_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [secret, enabled ? 1 : 0, userId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async updatePterodactylId(userId, pterodactylId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE users SET pterodactyl_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [pterodactylId, userId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    // ==================== SERVER PLANS METHODS ====================
    
    async createPlan(planData) {
        return new Promise((resolve, reject) => {
            const { name, description, price, billing_cycle, cpu, ram, disk, swap, io, databases, backups, allocations, 
                    egg_id, location_ids, docker_image, startup_command, environment_variables, 
                    user_limit, stock_limit, enabled, category, sort_order } = planData;
            
            this.db.run(`
                INSERT INTO server_plans (
                    name, description, price, billing_cycle, cpu, ram, disk, swap, io, databases, backups, allocations,
                    egg_id, location_ids, docker_image, startup_command, environment_variables,
                    user_limit, stock_limit, enabled, category, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [name, description, price, billing_cycle || 'monthly', cpu, ram, disk, swap || 0, io || 500, databases || 0, backups || 0, allocations || 1,
                egg_id, location_ids, docker_image, startup_command, environment_variables,
                user_limit || 0, stock_limit || 0, enabled ? 1 : 0, category || 'general', sort_order || 0],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    }

    async getAllPlans() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM server_plans ORDER BY sort_order ASC, created_at DESC', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async getEnabledPlans() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM server_plans WHERE enabled = 1 ORDER BY sort_order ASC, created_at DESC', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async getPlanById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM server_plans WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async updatePlan(id, planData) {
        return new Promise((resolve, reject) => {
            const { name, description, price, billing_cycle, cpu, ram, disk, swap, io, databases, backups, allocations,
                    egg_id, location_ids, docker_image, startup_command, environment_variables,
                    user_limit, stock_limit, enabled, category, sort_order } = planData;
            
            this.db.run(`
                UPDATE server_plans SET
                    name = ?, description = ?, price = ?, billing_cycle = ?, cpu = ?, ram = ?, disk = ?, swap = ?, io = ?,
                    databases = ?, backups = ?, allocations = ?, egg_id = ?, location_ids = ?,
                    docker_image = ?, startup_command = ?, environment_variables = ?,
                    user_limit = ?, stock_limit = ?, enabled = ?, category = ?, sort_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [name, description, price, billing_cycle || 'monthly', cpu, ram, disk, swap, io, databases, backups, allocations,
                egg_id, location_ids, docker_image, startup_command, environment_variables,
                user_limit, stock_limit, enabled ? 1 : 0, category, sort_order, id],
            function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async deletePlan(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM server_plans WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async incrementPlanStock(id) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE server_plans SET stock_used = stock_used + 1 WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async decrementPlanStock(id) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE server_plans SET stock_used = stock_used - 1 WHERE id = ? AND stock_used > 0', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // ==================== USER SERVERS METHODS ====================

    async createUserServer(serverData) {
        return new Promise((resolve, reject) => {
            const { user_id, plan_id, pterodactyl_server_id, server_name, server_identifier, status, expires_at } = serverData;
            
            this.db.run(`
                INSERT INTO user_servers (user_id, plan_id, pterodactyl_server_id, server_name, server_identifier, status, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [user_id, plan_id, pterodactyl_server_id, server_name, server_identifier, status || 'active', expires_at],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    }

    async getUserServers(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT us.*, sp.name as plan_name, sp.cpu, sp.ram, sp.disk
                FROM user_servers us
                LEFT JOIN server_plans sp ON us.plan_id = sp.id
                WHERE us.user_id = ?
                ORDER BY us.created_at DESC
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async getUserServerById(id) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT us.*, sp.name as plan_name
                FROM user_servers us
                LEFT JOIN server_plans sp ON us.plan_id = sp.id
                WHERE us.id = ?
            `, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getUserServerCount(userId, planId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT COUNT(*) as count FROM user_servers WHERE user_id = ? AND plan_id = ? AND status = "active"',
                [userId, planId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.count : 0);
                }
            );
        });
    }

    async getAllUserServers() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT us.*, sp.name as plan_name, u.email as user_email
                FROM user_servers us
                LEFT JOIN server_plans sp ON us.plan_id = sp.id
                LEFT JOIN users u ON us.user_id = u.id
                ORDER BY us.created_at DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async updateServerStatus(id, status) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE user_servers SET status = ? WHERE id = ?', [status, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    async deleteUserServer(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM user_servers WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('✓ Database connection closed');
            }
        });
    }
}

module.exports = Database;
