require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Environment variables and constants
const REQUIRED_ENV_VARS = [
    'TOKEN', 'STATUS_CHANNEL_ID', 'NOTIFICATION_CHANNEL_ID', 'STATUS_COMMAND',
    'STATUS_RED_NAME', 'STATUS_YELLOW_NAME', 'STATUS_GREEN_NAME', 'FETCH_INTERVAL_RED',
    'FETCH_INTERVAL_YELLOW', 'FETCH_INTERVAL_GREEN', 'NOTIFICATION_MESSAGE_RED',
    'NOTIFICATION_MESSAGE_YELLOW', 'NOTIFICATION_MESSAGE_GREEN', 'NOTIFICATION_TIMEOUT',
    'STATUS_COMMAND_CHANNELS', 'CUSTOM_MESSAGE_LINE'
];

REQUIRED_ENV_VARS.forEach(envVar => {
    if (!process.env[envVar]) {
        console.error(`Environment variable ${envVar} is not defined`);
        process.exit(1);
    }
});

const TOKEN = process.env.TOKEN;
const STATUS_CHANNELS = process.env.STATUS_CHANNEL_ID
    ? process.env.STATUS_CHANNEL_ID.split(',').filter(id => id.trim().length > 0)
    : [];
const NOTIFICATION_CHANNELS = process.env.NOTIFICATION_CHANNEL_ID
    ? process.env.NOTIFICATION_CHANNEL_ID.split(',').filter(id => id.trim().length > 0)
    : [];
const STATUS_COMMAND = process.env.STATUS_COMMAND;
const STATUS_RED_NAME = process.env.STATUS_RED_NAME;
const STATUS_YELLOW_NAME = process.env.STATUS_YELLOW_NAME;
const STATUS_GREEN_NAME = process.env.STATUS_GREEN_NAME;
const FETCH_INTERVAL_RED = parseInt(process.env.FETCH_INTERVAL_RED);
const FETCH_INTERVAL_YELLOW = parseInt(process.env.FETCH_INTERVAL_YELLOW);
const FETCH_INTERVAL_GREEN = parseInt(process.env.FETCH_INTERVAL_GREEN);
const NOTIFICATION_MESSAGE_RED = process.env.NOTIFICATION_MESSAGE_RED;
const NOTIFICATION_MESSAGE_YELLOW = process.env.NOTIFICATION_MESSAGE_YELLOW;
const NOTIFICATION_MESSAGE_GREEN = process.env.NOTIFICATION_MESSAGE_GREEN;
const NOTIFICATION_TIMEOUT = parseInt(process.env.NOTIFICATION_TIMEOUT);
const STATUS_COMMAND_CHANNELS = process.env.STATUS_COMMAND_CHANNELS 
    ? process.env.STATUS_COMMAND_CHANNELS.split(',').filter(id => id.trim().length > 0)
    : [];
const CUSTOM_MESSAGE_LINE = process.env.CUSTOM_MESSAGE_LINE;

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// State management
let notificationTimeout = null;
let latestNotification = null;
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
    const logMessage = `[${timestamp}] ${message}`;
    if (error) {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }
};

// Enhanced logging function for state changes
const logStateChange = (context, details) => {
    const timestamp = formatDate();
    const detailsStr = Object.entries(details)
        .map(([key, value]) => `    ${key}: ${value}`)
        .join('\n');
    log(`[${context}]\n${detailsStr}`);
};

// API Functions
const fetchBlocks = async (limit = 11) => {
    try {
        log('Fetching blocks...');
        const response = await axios.get('https://api.routescan.io/v2/network/testnet/evm/3636/blocks?count=false&sort=desc');
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

    if (timeDifference > 600) return 'status_red';
    if (timeDifference > 60 || emptyBlockCount > 6) return 'status_yellow';
    return 'status_green';
};

const getStatusName = (status) => {
    const statusMap = {
        status_red: STATUS_RED_NAME,
        status_yellow: STATUS_YELLOW_NAME,
        status_green: STATUS_GREEN_NAME
    };
    return statusMap[status] || '';
};

const getNotificationMessage = (status) => {
    const messageMap = {
        status_red: NOTIFICATION_MESSAGE_RED,
        status_yellow: NOTIFICATION_MESSAGE_YELLOW,
        status_green: NOTIFICATION_MESSAGE_GREEN
    };
    return messageMap[status] || '';
};

// Channel Management Functions
const setChannelName = async (status) => {
    const newName = getStatusName(status);
    
    for (const channelId of STATUS_CHANNELS) {
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

            if (channel.name !== newName) {
                await channel.setName(newName);
                log(`Channel ${channelId} name updated to: ${newName}`);
            }
            await sleep(1000);
        } catch (error) {
            log(`Error updating channel ${channelId} name: ${error.message}`, true);
        }
    }
};

const sendNotification = async (status) => {
    const message = getNotificationMessage(status);
    const finalMessage = `${message}\n${CUSTOM_MESSAGE_LINE}`;
    
    logStateChange('SENDING_NOTIFICATION', {
        'Status': status,
        'Message': message,
        'Channels': NOTIFICATION_CHANNELS.join(', ')
    });
    
    for (const channelId of NOTIFICATION_CHANNELS) {
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

            await channel.send(finalMessage);
            log(`Notification sent to channel ${channelId}`);
            await sleep(1000);
        } catch (error) {
            log(`Failed to send to channel ${channelId}: ${error.message}`, true);
            continue;
        }
    }
};

// Status Check Function
const checkStatus = async () => {
    const blocks = await fetchBlocks();
    if (blocks.length < 11) {
        log('Insufficient blocks fetched');
        return FETCH_INTERVAL_RED;
    }

    const newStatus = determineStatus(blocks);
    const currentTime = new Date();

    logStateChange('STATUS_CHECK', {
        'New Status': newStatus,
        'Current Status': currentStatus,
        'Previous Status': previousStatus,
        'Latest Notification': latestNotification,
        'Last Sent Notification': lastSentNotification,
        'Notification Timeout Active': notificationTimeout !== null,
        'Time Since Last State Change': stateChangeTime ? `${(currentTime - stateChangeTime) / 1000}s` : 'N/A'
    });

    await setChannelName(newStatus);

    // Initialize lastSentNotification if it is null
    if (lastSentNotification === null) {
        lastSentNotification = getNotificationMessage(newStatus);
        log(`Initialized lastSentNotification to: ${lastSentNotification}`);
    }

    if (newStatus !== currentStatus && previousStatus !== '') {
        logStateChange('STATUS_CHANGE_DETECTED', {
            'From': currentStatus,
            'To': newStatus,
            'Time': formatDate()
        });
        
        stateChangeTime = currentTime;

        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            log('Previous notification timeout cleared');
        }

        latestNotification = getNotificationMessage(newStatus);
        
        logStateChange('NOTIFICATION_DECISION', {
            'Latest Notification': latestNotification,
            'Last Sent Notification': lastSentNotification,
            'Will Send': latestNotification !== lastSentNotification,
            'Timeout Period': `${NOTIFICATION_TIMEOUT}ms`
        });
        
        if (latestNotification !== lastSentNotification) {
            log('Setting notification timeout - messages are different');
            notificationTimeout = setTimeout(async () => {
                logStateChange('TIMEOUT_TRIGGERED', {
                    'Latest Notification': latestNotification,
                    'Last Sent Notification': lastSentNotification,
                    'Current Status': currentStatus,
                    'Time Since State Change': `${(new Date() - stateChangeTime) / 1000}s`
                });
                
                if (latestNotification && latestNotification !== lastSentNotification) {
                    await sendNotification(latestNotification);
                    previousStatus_notification = currentStatus;
                    lastSentNotification = latestNotification;
                    log(`Last sent notification updated to: ${latestNotification}`);
                    latestNotification = null;
                    log('Latest notification cleared');
                } else {
                    logStateChange('NOTIFICATION_SKIPPED', {
                        'Latest Notification': latestNotification,
                        'Last Sent': lastSentNotification,
                        'Reason': latestNotification === lastSentNotification ? 'Duplicate notification' : 'Notification cleared'
                    });
                }
            }, NOTIFICATION_TIMEOUT);
        } else {
            log('Notification skipped - message matches last sent notification');
            latestNotification = null;
            log('Latest notification cleared');
        }
    }

    previousStatus = currentStatus;
    currentStatus = newStatus;

    const intervals = {
        status_red: FETCH_INTERVAL_RED,
        status_yellow: FETCH_INTERVAL_YELLOW,
        status_green: FETCH_INTERVAL_GREEN
    };

    const fetchInterval = intervals[newStatus];
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

        const blocks = await fetchBlocks(100);
        if (blocks.length === 0) {
            await message.channel.send('No blocks fetched.');
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

        const statusMessage = `
${getNotificationMessage(networkStatus)}

Blocks analyzed: ${blocks.length}
Latest block: ${lastBlock.number} (${lastBlock.txCount} transactions), age: ${blockAge} seconds
Average block time: ${avgBlockTime.toFixed(2)} seconds
Empty blocks: ${emptyBlockCount} (${emptyBlocksPercentage}%)
${CUSTOM_MESSAGE_LINE}`;

        await message.channel.send(statusMessage.trim());
    } catch (error) {
        log(`Command error: ${error.message}`, true);
        if (message && message.channel && typeof message.channel.send === 'function') {
            await message.channel.send('Error processing request.');
        }
    }
};

// Event Handlers
client.once('ready', async () => {
    log(`Logged in as ${client.user.tag}`);
    
    log('Validating status channels...');
    for (const channelId of STATUS_CHANNELS) {
        try {
            const channel = await client.channels.fetch(channelId.trim());
            log(`✓ Status channel ${channel.name} (${channelId}) validated`);
        } catch (error) {
            log(`✗ Invalid status channel ${channelId}: ${error.message}`, true);
        }
    }

    log('Validating notification channels...');
    for (const channelId of NOTIFICATION_CHANNELS) {
        try {
            const channel = await client.channels.fetch(channelId.trim());
            log(`✓ Notification channel ${channel.name} (${channelId}) validated`);
        } catch (error) {
            log(`✗ Invalid notification channel ${channelId}: ${error.message}`, true);
        } 
    }

    let fetchInterval = await checkStatus();
    setInterval(async () => {
        fetchInterval = await checkStatus();
    }, fetchInterval);
});

client.on('messageCreate', async (message) => {
    if (message.content.trim() === STATUS_COMMAND && 
        STATUS_COMMAND_CHANNELS.includes(message.channel.id)) {
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

// Start the bot
client.login(TOKEN).catch(error => {
    log(`Login failed: ${error.message}`, true);
    process.exit(1);
});