const config = require('./config');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const Faucet = require('./faucet');

// Initialize chalk with default values
let chalk = {
    red: (text) => text,
    yellow: (text) => text,
    green: (text) => text,
    cyanBright: (text) => text,
    yellowBright: (text) => text
};

// Async function to initialize chalk
async function initializeChalk() {
    try {
        const chalkModule = await import('chalk');
        chalk = chalkModule.default;
        return true;
    } catch (error) {
        console.error('Failed to load chalk:', error);
        return false;
    }
}

// Main bot initialization and execution
async function startBot() {
    // Initialize chalk first
    await initializeChalk();

    // State management
    let notificationTimeout = null;
    let recentNotification = null;
    let lastSentNotification = null;
    let currentStatus = '';
    let previousStatus = '';
    let previousStatus_notification = 'status_green';
    let stateChangeTime = null;

    // Utility Functions
    const formatDate = () => {
        return new Date().toISOString().replace('T', ' ').slice(0, 19);
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const log = (message, error = false) => {
        const timestamp = formatDate();
        const logMessage = `[${timestamp}] ${message.trim()}`;
        if (error) {
            console.log(chalk.red(logMessage));
        } else {
            console.log(logMessage);
        }
    };

    const logStateChange = (context, details) => {
        const timestamp = formatDate();
        const detailsStr = Object.entries(details)
            .map(([key, value]) => `    ${key}: ${value}`)
            .join('\n');
        log(`[${context}]\n${detailsStr}`);
    };

    // Function to validate all channels
    const validateAllChannels = async () => {
        log('Starting periodic channel validation...');
        
        // Validate status channels
        for (const channelId of config.getAllStatusChannels()) {
            try {
                const channel = await client.channels.fetch(channelId.trim());
                log(`[√] Status channel ${chalk.yellowBright(channel.name)} (${channelId}) validated`);
            } catch (error) {
                log(`[×] Invalid status channel ${channelId}: ${error.message}`, true);
            }
        }

        // Validate notification channels
        for (const channelId of config.getAllNotificationChannels()) {
            try {
                const channel = await client.channels.fetch(channelId.trim());
                log(`[√] Notification channel ${chalk.yellowBright(channel.name)} (${channelId}) validated`);
            } catch (error) {
                log(`[×] Invalid notification channel ${channelId}: ${error.message}`, true);
            }
        }

        // Validate guild-specific channels
        for (const [guildId, guildConfig] of config.guilds.entries()) {
            try {
                const guild = await client.guilds.fetch(guildId);
                log(`Validating channels for Guild ${chalk.cyanBright(guild.name)} (${guildId})...`);
                
                if (guildConfig.statusChannelId) {
                    try {
                        const channel = await client.channels.fetch(guildConfig.statusChannelId);
                        log(`[√] Guild status channel ${chalk.yellowBright(channel.name)} (${guildConfig.statusChannelId}) validated`);
                    } catch (error) {
                        log(`[×] Invalid guild status channel ${guildConfig.statusChannelId}: ${error.message}`, true);
                    }
                }

                if (guildConfig.notificationChannelIds && guildConfig.notificationChannelIds.length > 0) {
                    for (const channelId of guildConfig.notificationChannelIds) {
                        try {
                            const channel = await client.channels.fetch(channelId);
                            log(`[√] Guild notification channel ${chalk.yellowBright(channel.name)} (${channelId}) validated`);
                        } catch (error) {
                            log(`[×] Invalid guild notification channel ${channelId}: ${error.message}`, true);
                        }
                    }
                }
            } catch (error) {
                log(`[×] Could not fetch guild ${guildId}: ${error.message}`, true);
            }
        }
        log('Channel validation completed');
    };

    // Initialize Discord client
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    // API Functions
    const fetchBlocks = async (limit = config.api.blocks.defaultLimit) => {
        try {
            log('Fetching blocks...');
            const response = await axios.get(config.getApiUrl('blocks'));
            log('Blocks fetched successfully');
            return response.data.items.slice(0, limit);
        } catch (error) {
            log(`Error fetching blocks: ${error.message}`, true);
            return [];
        }
    };

    // Status Management Functions
    const determineStatus = (blocks) => {
        const latestBlock = blocks[0];
        const latestTimestamp = new Date(latestBlock.timestamp);
        const currentTime = new Date();
        const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000;

        const emptyBlockCount = blocks.filter(block => block.txCount === 0).length;

        log(`Time since last block: ${timeDifference.toFixed(2)} seconds`);
        log(`Empty blocks: ${emptyBlockCount}`);

        if (timeDifference > config.status.thresholds.criticalBlockAge) return 'red';
        if (timeDifference > config.status.thresholds.warningBlockAge || 
            emptyBlockCount > config.status.thresholds.maxEmptyBlocks) return 'yellow';
        return 'green';
    };

    // Channel Management Functions
    const setChannelName = async (status) => {
        // Handle global status channels
        for (const channelId of config.status.channels.status) {
            try {
                if (!channelId || typeof channelId !== 'string') {
                    log(`Invalid channel ID: ${channelId}`, true);
                    continue;
                }

                const channel = await client.channels.fetch(channelId.trim());
                if (!channel) {
                    log(`Cannot access channel ${channelId}`, true);
                    continue;
                }

                const newName = config.getStatusName(status, channel.guild.id);
                if (channel.name !== newName) {
                    await channel.setName(newName);
                    log(`Channel ${chalk.yellowBright(channel.name)} (${channelId}) name updated to: ${newName} (Guild: ${chalk.cyanBright(channel.guild.name)} (${channel.guild.id}))`);
                }
                await sleep(config.system.sleepBetweenChannelUpdates);
            } catch (error) {
                log(`Error updating channel ${channelId} name: ${error.message}`, true);
            }
        }

        // Handle guild-specific status channels
        for (const [guildId, guildConfig] of config.guilds.entries()) {
            if (!guildConfig.statusChannelId) continue;

            try {
                const channel = await client.channels.fetch(guildConfig.statusChannelId);
                if (!channel) {
                    log(`Cannot access guild-specific channel ${guildConfig.statusChannelId} for guild ${guildId}`, true);
                    continue;
                }

                const newName = config.getStatusName(status, guildId);
                if (channel.name !== newName) {
                    await channel.setName(newName);
                    log(`Guild-specific channel ${chalk.yellowBright(channel.name)} (${guildConfig.statusChannelId}) name updated to: ${newName} (Guild: ${chalk.cyanBright(channel.guild.name)} (${channel.guild.id}))`);
                }
                await sleep(config.system.sleepBetweenChannelUpdates);
            } catch (error) {
                log(`Error updating guild-specific channel for guild ${guildId}: ${error.message}`, true);
            }
        }
    };

    // Notification Functions
    const sendNotification = async (status) => {
        log(`Preparing notification for status: ${status}`);
        const message = config.getNotificationMessage(status);
        log(`Status message: ${message}`);
        
        const embed = {
            color: config.getEmbedColor(status),
            title: message,
            footer: {
                text: config.branding.name,
                icon_url: config.branding.iconUrl
            },
            timestamp: new Date()
        };
        
        if (config.customMessages.blockExplorerUrl) {
            embed.description = 'Block explorer: ' + config.customMessages.blockExplorerUrl;
        }

        // Send to global notification channels
        for (const channelId of config.status.channels.notification) {
            try {
                if (!channelId || typeof channelId !== 'string') {
                    log(`Invalid channel ID: ${channelId}`, true);
                    continue;
                }

                const channel = await client.channels.fetch(channelId.trim());
                if (!channel || !channel.send) {
                    log(`Cannot access channel or send messages to ${channelId}`, true);
                    continue;
                }

                await channel.send({ embeds: [embed] });
                log(`Notification sent to channel ${chalk.yellowBright(channel.name)} (${channelId}) (Guild: ${chalk.cyanBright(channel.guild.name)} (${channel.guild.id}))`);
                await sleep(config.system.sleepBetweenChannelUpdates);
            } catch (error) {
                log(`Failed to send to channel ${channelId}: ${error.message}`, true);
            }
        }

        // Send to guild-specific notification channels
        for (const [guildId, guildConfig] of config.guilds.entries()) {
            if (!guildConfig.notificationChannelIds || guildConfig.notificationChannelIds.length === 0) continue;

            for (const channelId of guildConfig.notificationChannelIds) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (!channel || !channel.send) {
                        log(`Cannot access guild-specific notification channel ${channelId} for guild ${guildId}`, true);
                        continue;
                    }

                    await channel.send({ embeds: [embed] });
                    log(`Notification sent to guild-specific channel ${chalk.yellowBright(channel.name)} (${channelId}) (Guild: ${chalk.cyanBright(channel.guild.name)} (${channel.guild.id}))`);
                    await sleep(config.system.sleepBetweenChannelUpdates);
                } catch (error) {
                    log(`Failed to send to guild-specific channel ${channelId} for guild ${guildId}: ${error.message}`, true);
                }
            }
        }
    };

    // Status Check Function
    const checkStatus = async () => {
        const blocks = await fetchBlocks();
        if (blocks.length < config.api.blocks.defaultLimit) {
            log('Insufficient blocks fetched');
            return config.getFetchInterval('red');
        }

        const newStatus = determineStatus(blocks);
        const currentTime = new Date();

        const logStatus = (status) => {
            if (!status) return 'undefined';
            if (status === 'red') return chalk.red(status);
            if (status === 'yellow') return chalk.yellow(status);
            return chalk.green(status);
        };

        logStateChange('STATUS_CHECK', {
            'New Status': logStatus(newStatus),
            'Current Status': logStatus(currentStatus),
            'Previous Status': logStatus(previousStatus),
            'Recent Notification': logStatus(recentNotification),
            'Last Sent Notification': logStatus(lastSentNotification),
            'Notification Timeout Active': notificationTimeout !== null,
            'Time Since Last State Change': stateChangeTime ? `${(currentTime - stateChangeTime) / 1000}s` : 'N/A'
        });

        await setChannelName(newStatus);

        if (lastSentNotification === null) {
            lastSentNotification = newStatus;
            log(`Initialized lastSentNotification to: ${logStatus(lastSentNotification)}`);
        }

        if (newStatus !== currentStatus && previousStatus !== '') {
            logStateChange('STATUS_CHANGE_DETECTED', {
                'From': logStatus(currentStatus),
                'To': logStatus(newStatus),
                'Time': formatDate()
            });
            
            stateChangeTime = currentTime;

            if (notificationTimeout) {
                clearTimeout(notificationTimeout);
                log('Previous notification timeout cleared');
            }

            recentNotification = newStatus;
            
            if (recentNotification !== lastSentNotification) {
                log('Setting notification timeout - status has changed');
                notificationTimeout = setTimeout(async () => {
                    if (recentNotification && recentNotification !== lastSentNotification) {
                        await sendNotification(recentNotification);
                        previousStatus_notification = currentStatus;
                        lastSentNotification = recentNotification;
                        log(`Last sent notification updated to: ${logStatus(recentNotification)}`);
                        recentNotification = null;
                    }
                }, config.notifications.timeout);
            } else {
                log('Notification skipped - status matches last sent notification');
                recentNotification = null;
            }
        }

        previousStatus = currentStatus;
        currentStatus = newStatus;

        const fetchInterval = config.getFetchInterval(newStatus);
        log(`Next check in ${fetchInterval / 1000} seconds`);
        return fetchInterval;
    };

    // Command Handler Function
    const handleStatusCommand = async (message) => {
        try {
            if (!message || !message.channel || typeof message.channel.send !== 'function') {
                log('Invalid message object or channel', true);
                return;
            }

            const blocks = await fetchBlocks(config.api.blocks.commandLimit);
            if (blocks.length === 0) {
                await message.channel.send({
                    embeds: [{
                        color: config.getEmbedColor('red'),
                        title: 'Error',
                        description: 'No blocks fetched.',
                        timestamp: new Date()
                    }]
                });
                return;
            }

            const networkStatus = determineStatus(blocks);
            const lastBlock = blocks[0];
            
            const timeDiffs = blocks.slice(1).map((block, i) => {
                const prevBlockTime = new Date(blocks[i].timestamp);
                const currentBlockTime = new Date(block.timestamp);
                return (prevBlockTime - currentBlockTime) / 1000;
            });
            
            const latestBlockTime = new Date(lastBlock.timestamp);
            const currentTime = new Date();
            const blockAge = Math.floor((currentTime - latestBlockTime) / 1000);

            timeDiffs.push(blockAge);
            const avgBlockTime = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;

            const emptyBlockCount = blocks.filter(block => block.txCount === 0).length;
            const emptyBlocksPercentage = ((emptyBlockCount / blocks.length) * 100).toFixed(0);

            const statusInfo = {
                red: { emoji: '🚫', color: config.getEmbedColor('red') },
                yellow: { emoji: '⚠️', color: config.getEmbedColor('yellow') },
                green: { emoji: '✅', color: config.getEmbedColor('green') }
            };

            await message.channel.send({
                embeds: [{
                    color: statusInfo[networkStatus].color,
                    title: `${config.getNotificationMessage(networkStatus)}`,
                    description: `Latest block: #${lastBlock.number}, ${lastBlock.txCount} tx, age: ${blockAge} seconds\n\u200B`,
                    fields: [
                        {
                            name: 'Blocks\nanalyzed',
                            value: `${blocks.length}\n \n`,
                            inline: true
                        },
                        {
                            name: 'Empty\nblocks',
                            value: `${emptyBlockCount} (${emptyBlocksPercentage}%)\n \n`,
                            inline: true
                        },
                        {
                            name: 'Avg\nblock time',
                            value: `${avgBlockTime.toFixed(2)} seconds`,
                            inline: true
                        },
                        {
                            name: '\u200B',
                            value: '\n\n',
                            inline: false
                        },
                        {
                            name: 'Block explorer:',
                            value: `${config.customMessages.blockExplorerUrl}`,
                            inline: false
                        }
                    ],
                    footer: {
                        text: config.branding.name,
                        icon_url: config.branding.iconUrl
                    },
                    timestamp: new Date()
                }]
            });
        } catch (error) {
            log(`Command error: ${error.message}`, true);
            if (message && message.channel && typeof message.channel.send === 'function') {
                await message.channel.send({
                    embeds: [{
                        color: config.getEmbedColor('red'),
                        title: 'Error',
                        description: 'Error processing request.',
                        timestamp: new Date()
                    }]
                });
            }
        }
    };

    // Event Handlers
    client.once('ready', async () => {
        log(`Logged in as ${client.user.tag}`);
        
        // Log configuration summary
        const configSummary = config.getConfigSummary();
        log(`Configuration loaded: ${JSON.stringify(configSummary)}`);
        
        // Initial channel validation
        await validateAllChannels();

        // Set up periodic channel validation
        setInterval(validateAllChannels, config.system.channelValidationInterval);

        let fetchInterval = await checkStatus();
        setInterval(async () => {
            try {
                fetchInterval = await checkStatus();
            } catch (error) {
                log(`Error in status check interval: ${error.message}`, true);
                fetchInterval = config.getFetchInterval('red');
            }
        }, fetchInterval);

        // Initialize faucet monitoring
        const faucetMonitor = new Faucet(client, config);
        await faucetMonitor.start();
    });

    client.on('messageCreate', async (message) => {
        if (message.content.trim() === config.commands.status.command && 
            config.isStatusCommandAllowed(message.channel.id)) {
            await handleStatusCommand(message);
        }
    });

    // Error Handling
    client.on('error', error => {
        log(`Client error: ${error.message}`, true);
    });

    process.on('unhandledRejection', error => {
        log(`Unhandled rejection: ${error.message}`, true);
    });

    process.on('uncaughtException', error => {
        log(`Uncaught exception: ${error.message}`, true);
        client.destroy();
        process.exit(1);
    });

    // Graceful shutdown handling
    process.on('SIGINT', () => {
        log('Received SIGINT. Performing graceful shutdown...');
        client.destroy();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        log('Received SIGTERM. Performing graceful shutdown...');
        client.destroy();
        process.exit(0);
    });

    // Start the bot
    try {
        await client.login(config.discord.token);
    } catch (error) {
        log(`Login failed: ${error.message}`, true);
        process.exit(1);
    }
}

// Start the bot with error handling
startBot().catch(error => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});