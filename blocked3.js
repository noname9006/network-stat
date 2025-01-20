require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
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
const STATUS_COMMAND_CHANNELS = process.env.STATUS_COMMAND_CHANNELS ? process.env.STATUS_COMMAND_CHANNELS.split(',') : [];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let notificationTimeout = null;
let latestNotification = null;
let currentStatus = '';

// Fetch blocks from the API
const fetchBlocks = async (limit = 11) => {
    try {
        console.log('API called');
        const response = await axios.get('https://api.routescan.io/v2/network/testnet/evm/3636/blocks?count=false&sort=desc');
        console.log('API replied');
        return response.data.items.slice(0, limit);
    } catch (error) {
        console.error('Error fetching block info:', error);
        return [];
    }
};

// Determine network status based on the fetched blocks
const determineStatus = (blocks) => {
    const latestBlock = blocks[0];
    const latestTimestamp = new Date(latestBlock.timestamp);
    const currentTime = new Date();
    const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000; // difference in seconds

    const emptyBlockCount = blocks.filter(block => block.txCount === 0).length;

    console.log(`Latest block timestamp difference to current time: ${timeDifference} seconds`);
    console.log(`Number of blocks with txCount 0: ${emptyBlockCount}`);

    if (timeDifference > 600) {
        return 'status_red';
    } else if ((timeDifference > 60 && timeDifference <= 600) || emptyBlockCount > 6) {
        return 'status_yellow';
    } else {
        return 'status_green';
    }
};

// Get status name based on the status key
const getStatusName = (status) => {
    switch (status) {
        case 'status_red':
            return STATUS_RED_NAME;
        case 'status_yellow':
            return STATUS_YELLOW_NAME;
        case 'status_green':
            return STATUS_GREEN_NAME;
        default:
            return '';
    }
};

// Get notification message based on the status key
const getNotificationMessage = (status) => {
    switch (status) {
        case 'status_red':
            return NOTIFICATION_MESSAGE_RED;
        case 'status_yellow':
            return NOTIFICATION_MESSAGE_YELLOW;
        case 'status_green':
            return NOTIFICATION_MESSAGE_GREEN;
        default:
            return '';
    }
};

// Update the status channel name based on the new status
const setChannelName = async (status) => {
    const statusChannel = await client.channels.fetch(STATUS_CHANNEL_ID);
    const newName = getStatusName(status);

    if (statusChannel.name !== newName) {
        await statusChannel.setName(newName);
        console.log(`Status channel name updated to: ${newName}`);
    }
};

// Send a notification message to the notification channel
const sendNotification = async (message) => {
    const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
    await notificationChannel.send(message);
    console.log('Notification sent:', message);
};

// Check and update the network status
const checkStatus = async () => {
    const blocks = await fetchBlocks();
    if (blocks.length < 11) {
        console.log('Insufficient blocks fetched');
        return;
    }

    console.log('Number of blocks fetched:', blocks.length);

    const newStatus = determineStatus(blocks);
    console.log('Status determined:', newStatus);

    // Ensure the channel name is up-to-date
    await setChannelName(newStatus);

    if (newStatus !== currentStatus) {
        // If there's an existing timeout, clear it
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
        }

        // Send new status notification
        latestNotification = getNotificationMessage(newStatus);
        notificationTimeout = setTimeout(async () => {
            if (latestNotification) {
                await sendNotification(latestNotification);
                latestNotification = null;
            }
        }, NOTIFICATION_TIMEOUT);

        currentStatus = newStatus;
    }

    let fetchInterval;
    if (newStatus === 'status_red') {
        fetchInterval = FETCH_INTERVAL_RED;
    } else if (newStatus === 'status_yellow') {
        fetchInterval = FETCH_INTERVAL_YELLOW;
    } else {
        fetchInterval = FETCH_INTERVAL_GREEN;
    }

    console.log(`Next fetch in ${fetchInterval / 1000} seconds`);
    return fetchInterval;
};

client.once('ready', async () => {
    console.log(`Bot is logged in as ${client.user.tag}`);

    let fetchInterval = await checkStatus();

    setInterval(async () => {
        fetchInterval = await checkStatus();
    }, fetchInterval);
});

client.on('messageCreate', async (message) => {
    const trimmedMessage = message.content.trim();
    if (trimmedMessage === STATUS_COMMAND && STATUS_COMMAND_CHANNELS.includes(message.channel.id)) {
        console.log('Command called:', STATUS_COMMAND);
        try {
            const blocks = await fetchBlocks(100); // Fetch all blocks
            const currentTime = new Date(); // Current date and time

            if (blocks.length > 0) {
                const networkStatus = determineStatus(blocks);
                const notificationMessage = getNotificationMessage(networkStatus);

                const lastBlock = blocks[0];
                const lastBlockNumber = lastBlock.number;
                const lastBlockTxCount = lastBlock.txCount;

                // Calculate time differences between consecutive blocks
                const timeDiffs = blocks.slice(1).map((block, i) => {
                    const prevBlockTimestamp = new Date(blocks[i].timestamp);
                    const currentBlockTimestamp = new Date(block.timestamp);
                    return (prevBlockTimestamp - currentBlockTimestamp) / 1000; // Difference in seconds
                });

                const avgBlockTime = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;

                const emptyBlockCount = blocks.filter(block => block.txCount === 0).length;
                const emptyBlocksPercentage = ((emptyBlockCount / blocks.length) * 100).toFixed(0);

                const statusMessage = `
Testnet status: ${notificationMessage}

Blocks fetched: ${blocks.length}
Last block: ${lastBlockNumber} with tx count: ${lastBlockTxCount}
Avg block time: ${avgBlockTime.toFixed(2)} seconds
Empty blocks percentage: ${emptyBlocksPercentage}%
                `;

                await message.channel.send(statusMessage.trim());
                console.log('Status message sent:', statusMessage.trim());
            } else {
                await message.channel.send('No blocks fetched.');
                console.log('No blocks fetched.');
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await message.channel.send('An error occurred while processing your request.');
        }
    }
});

client.login(TOKEN);