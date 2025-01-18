require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const TOKEN = process.env.TOKEN;
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const STATUS_RED_NAME = process.env.STATUS_RED_NAME;
const STATUS_YELLOW_NAME = process.env.STATUS_YELLOW_NAME;
const STATUS_GREEN_NAME = process.env.STATUS_GREEN_NAME;
const FETCH_INTERVAL_GREEN = process.env.FETCH_INTERVAL_GREEN || 60000; // Default to 60000 ms if not set
const FETCH_INTERVAL_YELLOW = process.env.FETCH_INTERVAL_YELLOW || 30000;
const FETCH_INTERVAL_RED = process.env.FETCH_INTERVAL_RED || 10000;
const NOTIFICATION_MESSAGE_RED = process.env.NOTIFICATION_MESSAGE_RED || "Status changed to red";
const NOTIFICATION_MESSAGE_YELLOW = process.env.NOTIFICATION_MESSAGE_YELLOW || "Status changed to yellow";
const NOTIFICATION_MESSAGE_GREEN = process.env.NOTIFICATION_MESSAGE_GREEN || "Status changed to green";
const NOTIFICATION_TIMEOUT = parseInt(process.env.NOTIFICATION_TIMEOUT) || 660000; // 11 minutes in milliseconds

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let notificationTimeout = null;
let latestNotification = null;

const fetchBlockInfo = async () => {
    const url = "https://api.routescan.io/v2/network/testnet/evm/3636/blocks?count=false&sort=desc";

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.items && data.items.length > 0) {
            const latestBlock = data.items[0];
            const latestTimestamp = new Date(latestBlock.timestamp);
            const currentTime = new Date();

            const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000; // difference in seconds

            // Logging the same events in console
            console.log(`Latest Block Number: ${latestBlock.number}`);
            console.log(`Latest Timestamp: ${latestTimestamp}`);
            console.log(`Current Time: ${currentTime}`);
            console.log(`Time Difference: ${timeDifference} seconds`);

            return data.items; // Return all fetched blocks
        }
    } catch (error) {
        console.error("Error fetching block info:", error);
    }
    return [];
};

const sendNotification = async (message) => {
    try {
        const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
        if (!notificationChannel) {
            console.error("Notification channel not found.");
            return;
        }
        await notificationChannel.send(message);
        console.log("Notification sent:", message);
    } catch (error) {
        console.error("Error sending notification:", error);
    }
};

const calculateNetworkStatus = async (blocks) => {
    const latestBlock = blocks[0];
    const latestTimestamp = new Date(latestBlock.timestamp);
    const currentTime = new Date();
    const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000; // difference in seconds

    const emptyBlockCount = blocks.filter(block => block.txcount === 0).length;
    const emptyBlockPercentage = (emptyBlockCount / blocks.length) * 100;

    let networkStatus = "operational ✅";
    if (timeDifference > 900) { // 900 seconds = 15 minutes
        networkStatus = "offline 🛑";
    } else if (timeDifference > 120 || emptyBlockPercentage > 50) { // 120 seconds = 2 minutes
        networkStatus = "unstable 🟨";
    }

    return networkStatus;
};

const checkTimeDifference = async () => {
    const blocks = await fetchBlockInfo();
    if (blocks.length < 11) {
        return;
    }

    const latestBlock = blocks[0];
    const latestTimestamp = new Date(latestBlock.timestamp);
    const currentTime = new Date();
    const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000; // difference in seconds

    const emptyBlockCount = blocks.filter(block => block.txcount === 0).length;
    const emptyBlockPercentage = (emptyBlockCount / blocks.length) * 100;

    const statusChannel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!statusChannel) {
        console.error("Status channel not found.");
        return;
    }

    let newStatus = STATUS_GREEN_NAME;
    let fetchInterval = FETCH_INTERVAL_GREEN;
    let notificationMessage = null;

    if (timeDifference > 900) { // 900 seconds = 15 minutes
        newStatus = STATUS_RED_NAME;
        fetchInterval = FETCH_INTERVAL_RED;
        notificationMessage = NOTIFICATION_MESSAGE_RED;
    } else if (timeDifference > 120 || emptyBlockPercentage > 50) { // 120 seconds = 2 minutes
        newStatus = STATUS_YELLOW_NAME;
        fetchInterval = FETCH_INTERVAL_YELLOW;
        notificationMessage = NOTIFICATION_MESSAGE_YELLOW;
    } else {
        newStatus = STATUS_GREEN_NAME;
        fetchInterval = FETCH_INTERVAL_GREEN;
        notificationMessage = NOTIFICATION_MESSAGE_GREEN;
    }

    if (statusChannel.name !== newStatus) {
        await statusChannel.setName(newStatus);

        // If there's an existing timeout, clear it
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
        }

        // Set the latest notification and start a new timeout
        latestNotification = notificationMessage;
        notificationTimeout = setTimeout(async () => {
            if (latestNotification) {
                await sendNotification(latestNotification);
                latestNotification = null;
            }
        }, NOTIFICATION_TIMEOUT);
    }
    
    return fetchInterval;
};

client.once("ready", async () => {
    console.log(`Bot is ready. Logged in as ${client.user.tag}`);
    let fetchInterval = FETCH_INTERVAL_GREEN;
    setInterval(async () => {
        fetchInterval = await checkTimeDifference();
    }, fetchInterval); // Check at the interval defined in the environment variable
});

client.on("messageCreate", async (message) => {
    if (message.content === "!networkstat") {
        const blocks = await fetchBlockInfo();
        const currentTime = new Date();

        if (blocks.length > 0) {
            const networkStatus = await calculateNetworkStatus(blocks);

            const latestBlock = blocks[0];
            const latestTimestamp = new Date(latestBlock.timestamp);
            const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000; // difference in seconds
            const age = new Date(currentTime - latestTimestamp).toISOString().substr(11, 8); // convert to HH:MM:SS format

            const emptyBlockCount = blocks.filter(block => block.txcount === 0).length;
            const emptyBlockPercentage = (emptyBlockCount / blocks.length) * 100;

            const timeDiffs = blocks.map((block, index) => {
                if (index < blocks.length - 1) {
                    return (new Date(block.timestamp) - new Date(blocks[index + 1].timestamp)) / 1000; // time difference in seconds
                }
                return 0;
            }).slice(0, -1);

            const meanTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;

            const networkStatMessage = `
                Current network status: ${networkStatus}
                Blocks fetched: ${blocks.length}
                Last block: #${latestBlock.number}, age: ${age}, tx count: ${latestBlock.txcount}
                Average block time: ${meanTimeDiff.toFixed(2)} seconds
                Empty blocks: ${emptyBlockPercentage.toFixed(2)}%
            `;

            await message.channel.send(networkStatMessage);
        } else {
            await message.channel.send("No blocks fetched.");
        }
    }
});

client.login(TOKEN);