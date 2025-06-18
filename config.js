require('dotenv').config();

/**
 * Centralized Configuration for Network Status Bot
 * This file consolidates all configuration parameters including environment variables
 * and provides default values where appropriate.
 */

class Config {
    constructor() {
        this.loadConfiguration();
        this.validateConfiguration();
    }

    loadConfiguration() {
        // Discord Bot Configuration
        this.discord = {
            token: process.env.TOKEN,
            intents: [
                'Guilds',
                'GuildMessages', 
                'MessageContent'
            ]
        };

        // API Configuration
        this.api = {
            blocks: {
                baseUrl: 'https://api.routescan.io/v2/network/testnet/evm/3636',
                blocksEndpoint: '/blocks?count=false&sort=desc',
                defaultLimit: 11,
                commandLimit: 100
            },
            faucet: {
                baseUrl: 'https://api.routescan.io/v2/network/testnet/evm/3636',
                address: '0x193B74C87eFFbB5f0C78002608c8C8A60e467668',
                balanceEndpoint: '/address/{address}/gas-balance'
            }
        };

        // Status Monitoring Configuration
        this.status = {
            names: {
                red: process.env.STATUS_RED_NAME || '⊢⛓ Testnet status: ❌',
                yellow: process.env.STATUS_YELLOW_NAME || '⊢⛓ Testnet status:️ 🟨',
                green: process.env.STATUS_GREEN_NAME || '⊢⛓ Testnet status: ✅'
            },
            fetchIntervals: {
                red: parseInt(process.env.FETCH_INTERVAL_RED) || 300000,
                yellow: parseInt(process.env.FETCH_INTERVAL_YELLOW) || 120000,
                green: parseInt(process.env.FETCH_INTERVAL_GREEN) || 90000
            },
            thresholds: {
                criticalBlockAge: 600, // seconds
                warningBlockAge: 60,   // seconds
                maxEmptyBlocks: 8      // out of analyzed blocks
            },
            channels: {
                status: process.env.STATUS_CHANNEL_ID
                    ? process.env.STATUS_CHANNEL_ID.split(',').filter(id => id.trim().length > 0)
                    : [],
                notification: process.env.NOTIFICATION_CHANNEL_ID
                    ? process.env.NOTIFICATION_CHANNEL_ID.split(',').filter(id => id.trim().length > 0)
                    : []
            }
        };

        // Notification Configuration
        this.notifications = {
            messages: {
                red: process.env.NOTIFICATION_MESSAGE_RED || 'Testnet status: **outage**  ❌️',
                yellow: process.env.NOTIFICATION_MESSAGE_YELLOW || 'Testnet status: **unstable**  ⚠️',
                green: process.env.NOTIFICATION_MESSAGE_GREEN || 'Testnet status: **operational**  ✅'
            },
            timeout: (parseInt(process.env.NOTIFICATION_TIMEOUT) || 900) * 1000, // Convert to milliseconds
            colors: {
                red: 0xFF0000,
                yellow: 0xFFFF00,
                green: 0x00FF00,
                default: 0xFFFFFF
            }
        };

        // Command Configuration
        this.commands = {
            status: {
                command: process.env.STATUS_COMMAND || '!testnetstat',
                allowedChannels: process.env.STATUS_COMMAND_CHANNELS
                    ? process.env.STATUS_COMMAND_CHANNELS.split(',').filter(id => id.trim().length > 0)
                    : []
            }
        };

        // Custom Messages
        this.customMessages = {
            blockExplorerUrl: process.env.CUSTOM_MESSAGE_LINE || 'https://testnet.botanixscan.io/'
        };

        // Guild Configuration
        this.guilds = this.loadGuildConfigurations();

        // Faucet Configuration
        this.faucet = {
            channelId: process.env.FAUCET_STAT,
            threshold: BigInt(process.env.FAUCET_THRESHOLD || '100000000000000'),
            fetchInterval: parseInt(process.env.FETCH_INTERVAL) || 300000,
            statusNames: {
                full: process.env.FAUCET_FULL_NAME || '・faucet status꞉💧・',
                dry: process.env.FAUCET_DRY_NAME || '・faucet status꞉❌・'
            }
        };

        // Branding Configuration
        this.branding = {
            name: 'Botanix Labs',
            iconUrl: 'https://a-us.storyblok.com/f/1014909/512x512/026e26392f/dark_512-1.png'
        };

        // System Configuration
        this.system = {
            channelValidationInterval: 24 * 60 * 60 * 1000, // 24 hours
            sleepBetweenChannelUpdates: 1000, // 1 second
            dateFormat: 'YYYY-MM-DD HH:mm:ss'
        };
    }

    loadGuildConfigurations() {
        const guilds = new Map();
        let guildIndex = 1;

        while (true) {
            const guildId = process.env[`GUILD${guildIndex}`];
            if (!guildId || guildId.trim().length === 0) break;

            const guildPrefix = guildIndex === 1 ? 'G1_' : `G${guildIndex}_`;
            
            const config = {
                id: guildId,
                notificationChannelIds: process.env[`${guildPrefix}NOTIFICATION_CHANNEL_ID`]
                    ? process.env[`${guildPrefix}NOTIFICATION_CHANNEL_ID`]
                        .split(',')
                        .map(id => id.trim())
                        .filter(id => id.length > 0)
                    : [],
                statusChannelId: process.env[`${guildPrefix}STATUS_CHANNEL_ID`],
                statusNames: {
                    red: process.env[`${guildPrefix}STATUS_RED_NAME`] || '',
                    yellow: process.env[`${guildPrefix}STATUS_YELLOW_NAME`] || '',
                    green: process.env[`${guildPrefix}STATUS_GREEN_NAME`] || ''
                }
            };

            if (config.statusChannelId || config.notificationChannelIds.length > 0) {
                guilds.set(guildId, config);
            }

            guildIndex++;
        }

        return guilds;
    }

    validateConfiguration() {
        const errors = [];

        // Validate required Discord token
        if (!this.discord.token) {
            errors.push('Discord TOKEN is required but not provided in environment variables');
        }

        // Validate fetch intervals are positive numbers
        Object.entries(this.status.fetchIntervals).forEach(([key, value]) => {
            if (isNaN(value) || value <= 0) {
                errors.push(`Invalid fetch interval for ${key}: ${value}`);
            }
        });

        // Validate notification timeout
        if (isNaN(this.notifications.timeout) || this.notifications.timeout < 0) {
            errors.push(`Invalid notification timeout: ${this.notifications.timeout}`);
        }

        // Validate faucet threshold
        if (typeof this.faucet.threshold !== 'bigint') {
            errors.push('Invalid faucet threshold: must be a valid BigInt');
        }

        if (errors.length > 0) {
            console.error('Configuration validation errors:');
            errors.forEach(error => console.error(`  - ${error}`));
            throw new Error('Configuration validation failed');
        }
    }

    // Getter methods for backward compatibility and easy access
    getApiUrl(endpoint = 'blocks') {
        switch (endpoint) {
            case 'blocks':
                return `${this.api.blocks.baseUrl}${this.api.blocks.blocksEndpoint}`;
            case 'faucet':
                return `${this.api.faucet.baseUrl}${this.api.faucet.balanceEndpoint.replace('{address}', this.api.faucet.address)}`;
            default:
                throw new Error(`Unknown API endpoint: ${endpoint}`);
        }
    }

    getStatusName(status, guildId = null) {
        // Check guild-specific names first
        if (guildId && this.guilds.has(guildId)) {
            const guildConfig = this.guilds.get(guildId);
            const guildStatusName = guildConfig.statusNames[status];
            if (guildStatusName) {
                return guildStatusName;
            }
        }

        // Fall back to global status names
        return this.status.names[status] || '';
    }

    getNotificationMessage(status) {
        return this.notifications.messages[status] || '';
    }

    getEmbedColor(status) {
        return this.notifications.colors[status] || this.notifications.colors.default;
    }

    getFetchInterval(status) {
        return this.status.fetchIntervals[status] || this.status.fetchIntervals.red;
    }

    // Utility method to check if a channel is allowed for status commands
    isStatusCommandAllowed(channelId) {
        return this.commands.status.allowedChannels.includes(channelId);
    }

    // Method to get all notification channels (global + guild-specific)
    getAllNotificationChannels() {
        const channels = [...this.status.channels.notification];
        
        for (const [guildId, config] of this.guilds) {
            channels.push(...config.notificationChannelIds);
        }
        
        return [...new Set(channels)]; // Remove duplicates
    }

    // Method to get all status channels (global + guild-specific)
    getAllStatusChannels() {
        const channels = [...this.status.channels.status];
        
        for (const [guildId, config] of this.guilds) {
            if (config.statusChannelId) {
                channels.push(config.statusChannelId);
            }
        }
        
        return [...new Set(channels)]; // Remove duplicates
    }

    // Method to get configuration summary for logging
    getConfigSummary() {
        return {
            guilds: this.guilds.size,
            statusChannels: this.getAllStatusChannels().length,
            notificationChannels: this.getAllNotificationChannels().length,
            commandChannels: this.commands.status.allowedChannels.length,
            faucetEnabled: !!this.faucet.channelId
        };
    }
}

// Export singleton instance
module.exports = new Config();