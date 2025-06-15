require('dotenv').config();
const axios = require('axios');

class Faucet {
    constructor(client) {
        this.client = client;
        this.currentStatus = '';
        this.faucetThreshold = parseFloat(process.env.FAUCET_THRESHOLD) || 0;
        this.fetchInterval = parseInt(process.env.FETCH_INTERVAL) || 60000; // default 1 minute
        this.faucetStatChannelId = process.env.FAUCET_STAT;
        this.statusNames = {
            status_full: process.env.FAUCET_FULL_NAME || '🟢│faucet-full',
            status_dry: process.env.FAUCET_DRY_NAME || '🔴│faucet-dry'
        };
        
        // Initialize chalk with default values
        this.chalk = {
            red: (text) => text,
            green: (text) => text,
            yellow: (text) => text,
            cyanBright: (text) => text
        };
        
        // Try to load chalk module
        import('chalk').then(chalkModule => {
            this.chalk = chalkModule.default;
        }).catch(error => {
            console.error('Failed to load chalk:', error);
        });
    }

    formatDate() {
        return new Date().toISOString().replace('T', ' ').slice(0, 19);
    }

    log(message, error = false) {
        const timestamp = this.formatDate();
        const logMessage = `[${timestamp}] [Faucet] ${message.trim()}`;
        if (error) {
            console.log(this.chalk.red(logMessage));
        } else {
            console.log(logMessage);
        }
    }

    async fetchFaucetBalance() {
    try {
        const response = await axios.get(
            'https://api.routescan.io/v2/network/testnet/evm/3636/address/0x193B74C87eFFbB5f0C78002608c8C8A60e467668/gas-balance'
        );
        
        this.log(`API Response: ${JSON.stringify(response.data)}`);
        
        if (!response.data?.items?.[0]?.balance) {
            this.log('Invalid API response: missing balance value', true);
            return null;
        }
        
        return BigInt(response.data.items[0].balance);
    } catch (error) {
        this.log(`Error fetching faucet balance: ${error.message}`, true);
        if (error.response) {
            this.log(`API Error Response: ${JSON.stringify(error.response.data)}`, true);
        }
        return null;
    }
}

determineStatus(balance) {
    if (balance === null) return 'status_dry';
    const thresholdWei = BigInt(this.faucetThreshold);
    this.log(`Comparing balance ${balance} with threshold ${thresholdWei}`);
    return balance > thresholdWei ? 'status_full' : 'status_dry';
}

    async updateChannelName(status) {
        if (!this.faucetStatChannelId) {
            this.log('No faucet status channel ID configured', true);
            return;
        }

        try {
            const channel = await this.client.channels.fetch(this.faucetStatChannelId);
            if (!channel) {
                this.log(`Cannot access channel ${this.faucetStatChannelId}`, true);
                return;
            }

            const newName = this.statusNames[status];
            if (!newName) {
                this.log(`No channel name configured for status: ${status}`, true);
                return;
            }

            if (channel.name !== newName) {
                await channel.setName(newName);
                this.log(`Channel ${this.chalk.cyanBright(channel.name)} updated to: ${newName}`);
            }
        } catch (error) {
            this.log(`Error updating channel name: ${error.message}`, true);
        }
    }

    async checkFaucetStatus() {
    const balance = await this.fetchFaucetBalance();
    
    // If balance is null, we should maintain the current status instead of changing to undefined
    if (balance === null) {
        this.log('Failed to fetch balance, maintaining current status', true);
        return;
    }

    const newStatus = this.determineStatus(balance);
    if (newStatus !== this.currentStatus) {
        this.log(`Status changed from ${this.currentStatus || 'initial'} to ${newStatus}`);
        this.log(`Current balance: ${balance}, Threshold: ${this.faucetThreshold}`);
        await this.updateChannelName(newStatus);
        this.currentStatus = newStatus;
    }
}

    async start() {
        this.log('Starting faucet monitoring...');
        
        // Perform initial check
        await this.checkFaucetStatus();

        // Set up interval for periodic checks
        setInterval(() => this.checkFaucetStatus(), this.fetchInterval);
    }
}

module.exports = Faucet;