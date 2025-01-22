require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Environment variables and constants
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
let currentStatus = '';
let previousStatus = '';

// Utility Functions
const formatDate = () => {
    return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
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
            const channel = await client.channels.fetch(channelId.trim());
            if (channel.name !== newName) {
                await channel.setName(newName);
                log(`Channel ${channelId} name updated to: ${newName}`);
            }
            await sleep(1000); // Rate limit prevention
        } catch (error) {
            log(`Error updating channel ${channelId} name: ${error.message}`, true);
        }
    }
};

const sendNotification = async (message) => {
    const finalMessage = `${message}\n${CUSTOM_MESSAGE_LINE}`;
    
    for (const channelId of NOTIFICATION_CHANNELS) {
        try {
            const channel = await client.channels.fetch(channelId.trim());
            await channel.send(finalMessage);
            log(`Notification sent to channel ${channelId}`);
            await sleep(1000); // Rate limit prevention
        } catch (error) {
            log(`Failed to send to channel ${channelId}: ${error.message}`, true);
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
    log(`Status: ${newStatus}`);

    await setChannelName(newStatus);

    // Only send a notification if the previous status is not an empty string
    if (newStatus !== currentStatus && previousStatus !== '') {
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
        }

        latestNotification = getNotificationMessage(newStatus);
        const statusBeforeTimeout = currentStatus;

        notificationTimeout = setTimeout(async () => {
            if (latestNotification) {
                await sendNotification(latestNotification);
                latestNotification = null;
            }
        }, NOTIFICATION_TIMEOUT);
    }

    previousStatus = currentStatus; // Update previousStatus here
    currentStatus = newStatus; // Update currentStatus here

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

        const avgBlockTime = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        const emptyBlockCount = blocks.filter(block => block.txCount === 0).length;
        const emptyBlocksPercentage = ((emptyBlockCount / blocks.length) * 100).toFixed(0);

        const statusMessage = `
${getNotificationMessage(networkStatus)}

Blocks analyzed: ${blocks.length}
Latest block: ${lastBlock.number} (${lastBlock.txCount} transactions)
Average block time: ${avgBlockTime.toFixed(2)} seconds
Empty blocks: ${emptyBlockCount} (${emptyBlocksPercentage}%)
${CUSTOM_MESSAGE_LINE}`;

        await message.channel.send(statusMessage.trim());
    } catch (error) {
        log(`Command error: ${error.message}`, true);
        await message.channel.send('Error processing request.');
    }
};

// Event Handlers
client.once('ready', async () => {
    log(`Logged in as ${client.user.tag}`);
    
    // Validate all channels
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