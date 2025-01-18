require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const STATUS_RED_NAME = process.env.STATUS_RED_NAME;
const STATUS_GREEN_NAME = process.env.STATUS_GREEN_NAME;
const FETCH_INTERVAL = process.env.FETCH_INTERVAL || 60000; // Default to 60000 ms if not set

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

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

            return data.items.slice(0, 5); // Return the last 5 blocks
        }
    } catch (error) {
        console.error("Error fetching block info:", error);
    }
    return [];
};

const checkTimeDifference = async () => {
    const blocks = await fetchBlockInfo();
    if (blocks.length < 5) {
        return;
    }

    const timestamps = blocks.map(block => new Date(block.timestamp));
    const timeDiffs = timestamps.map((timestamp, index) => {
        if (index < timestamps.length - 1) {
            return (timestamp - timestamps[index + 1]) / 1000; // time difference in seconds
        }
        return 0;
    }).slice(0, -1);

    const meanTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;

    const statusChannel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!statusChannel) {
        console.error("Status channel not found.");
        return;
    }

    if (meanTimeDiff > 300) { // 300 seconds = 5 minutes
        if (statusChannel.name !== STATUS_RED_NAME) {
            await statusChannel.setName(STATUS_RED_NAME);
        }
    } else {
        if (statusChannel.name !== STATUS_GREEN_NAME) {
            await statusChannel.setName(STATUS_GREEN_NAME);
        }
    }
};

client.once("ready", () => {
    console.log(`Bot is ready. Logged in as ${client.user.tag}`);
    setInterval(checkTimeDifference, FETCH_INTERVAL); // Check at the interval defined in the environment variable
});

client.login(TOKEN);