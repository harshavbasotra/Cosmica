const axios = require('axios');

class PterodactylAPI {
    constructor(panelUrl, apiKey, clientKey = null) {
        this.panelUrl = panelUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
        this.clientKey = clientKey;
        this.cache = new Map();
        this.cacheTTL = 60000; // 1 minute cache
        
        // Initialize API clients
        this.client = axios.create({
            baseURL: `${this.panelUrl}/api/application`,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        // Client API client (for real-time stats)
        if (this.clientKey) {
            this.clientApi = axios.create({
                baseURL: `${this.panelUrl}/api/client`,
                headers: {
                    'Authorization': `Bearer ${this.clientKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
        }
    }
    
    _getCacheKey(key) {
        return key;
    }
    
    _getCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }
        return null;
    }
    
    _setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    async createUser(email, password, firstName = 'User', lastName = 'Account') {
        try {
            const username = email.split('@')[0] + Math.floor(Math.random() * 1000);
            
            const response = await this.client.post('/users', {
                email: email,
                username: username,
                first_name: firstName,
                last_name: lastName,
                password: password
            });

            return {
                success: true,
                userId: response.data.attributes.id,
                data: response.data.attributes
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async getUserByEmail(email) {
        try {
            const response = await this.client.get(`/users?filter[email]=${encodeURIComponent(email)}`);
            
            if (response.data.data && response.data.data.length > 0) {
                return {
                    success: true,
                    user: response.data.data[0].attributes
                };
            }

            return {
                success: false,
                error: 'User not found'
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async updateUserPassword(userId, password) {
        try {
            await this.client.patch(`/users/${userId}`, {
                password: password
            });

            return { success: true };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async testConnection() {
        try {
            await this.client.get('/users?per_page=1');
            return { success: true };
        } catch (error) {
            console.error('Pterodactyl connection test failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getUserServers(userId) {
        // Check cache first
        const cacheKey = `user_servers_${userId}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return cached;
        }
        
        try {
            const response = await this.client.get(`/users/${userId}?include=servers`);
            
            if (response.data && response.data.attributes) {
                const relationships = response.data.attributes.relationships;
                
                if (!relationships || !relationships.servers || !relationships.servers.data) {
                    console.log('No servers found for user');
                    return {
                        success: true,
                        servers: []
                    };
                }
                
                const servers = relationships.servers.data;
                console.log(`Found ${servers.length} servers for user ${userId}`);
                
                // Map servers without fetching status (to avoid rate limiting)
                const mappedServers = servers.map(server => {
                    return {
                        id: server.attributes.id,
                        uuid: server.attributes.uuid,
                        identifier: server.attributes.identifier,
                        name: server.attributes.name,
                        description: server.attributes.description || '',
                        status: 'running', // Default status
                        limits: server.attributes.limits || { cpu: 0, memory: 0, disk: 0 },
                        feature_limits: server.attributes.feature_limits || {}
                    };
                });
                
                const result = {
                    success: true,
                    servers: mappedServers
                };
                
                // Cache the result
                this._setCache(cacheKey, result);
                return result;
            }

            const emptyResult = {
                success: true,
                servers: []
            };
            
            // Cache empty result too
            this._setCache(cacheKey, emptyResult);
            return emptyResult;
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message,
                servers: []
            };
        }
    }

    async getServerResources(identifier) {
        if (!this.clientApi) {
            return {
                success: false,
                error: 'Client API key not configured'
            };
        }

        try {
            const response = await this.clientApi.get(`/servers/${identifier}/resources`);
            const resources = response.data.attributes.resources;
            
            return {
                success: true,
                resources: {
                    memory_bytes: resources.memory_bytes,
                    cpu_absolute: resources.cpu_absolute,
                    disk_bytes: resources.disk_bytes,
                    network_rx_bytes: resources.network_rx_bytes,
                    network_tx_bytes: resources.network_tx_bytes,
                    uptime: resources.uptime,
                    state: response.data.attributes.current_state
                }
            };
        } catch (error) {
            console.error('Pterodactyl Client API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async updateUser(userId, data) {
        try {
            const response = await this.client.patch(`/users/${userId}`, data);
            return {
                success: true,
                user: response.data.attributes
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async updateUserPassword(userId, password) {
        try {
            const response = await this.client.patch(`/users/${userId}`, { password });
            return {
                success: true
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    // ==================== LOCATIONS ====================

    async getLocations() {
        try {
            const response = await this.client.get('/locations');
            return {
                success: true,
                data: response.data.data
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async getLocation(locationId) {
        try {
            const response = await this.client.get(`/locations/${locationId}`);
            return {
                success: true,
                data: response.data.attributes
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    // ==================== NESTS & EGGS ====================

    async getNests() {
        try {
            const response = await this.client.get('/nests');
            return {
                success: true,
                data: response.data.data
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async getNestEggs(nestId) {
        try {
            const response = await this.client.get(`/nests/${nestId}/eggs`);
            return {
                success: true,
                data: response.data.data
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async getEgg(nestId, eggId) {
        try {
            const response = await this.client.get(`/nests/${nestId}/eggs/${eggId}`);
            return {
                success: true,
                data: response.data.attributes
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    // ==================== SERVER CREATION ====================

    async createServer(serverData) {
        try {
            const { name, user, egg, docker_image, startup, environment, limits, feature_limits, allocation, deploy } = serverData;
            
            const response = await this.client.post('/servers', {
                name: name,
                user: user,
                egg: egg,
                docker_image: docker_image,
                startup: startup,
                environment: environment || {},
                limits: limits,
                feature_limits: feature_limits || {
                    databases: 0,
                    backups: 0,
                    allocations: 1
                },
                allocation: allocation || {
                    default: null
                },
                deploy: deploy
            });

            return {
                success: true,
                data: response.data.attributes
            };
        } catch (error) {
            console.error('Pterodactyl Server Creation Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async getServer(serverId) {
        try {
            const response = await this.client.get(`/servers/${serverId}`);
            return {
                success: true,
                data: response.data.attributes
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async suspendServer(serverId) {
        try {
            await this.client.post(`/servers/${serverId}/suspend`);
            return {
                success: true
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async unsuspendServer(serverId) {
        try {
            await this.client.post(`/servers/${serverId}/unsuspend`);
            return {
                success: true
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }

    async deleteServer(serverId) {
        try {
            await this.client.delete(`/servers/${serverId}`);
            return {
                success: true
            };
        } catch (error) {
            console.error('Pterodactyl API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.detail || error.message
            };
        }
    }
}

module.exports = PterodactylAPI;
