const axios = require('axios');

class Faucet {
    constructor(client, config = null) {
        this.client = client;
        this.config = config || require('./config');
        this.currentStatus = '';
        
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
            const response = await axios.get(this.config.getApiUrl('faucet'));
            
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
        if (balance === null) return 'dry';
        this.log(`Comparing balance ${balance} with threshold ${this.config.faucet.threshold}`);
        return balance > this.config.faucet.threshold ? 'full' : 'dry';
    }

    async updateChannelName(status) {
        if (!this.config.faucet.channelId) {
            this.log('No faucet status channel ID configured', true);
            return;
        }

        try {
            const channel = await this.client.channels.fetch(this.config.faucet.channelId);
            if (!channel) {
                this.log(`Cannot access channel ${this.config.faucet.channelId}`, true);
                return;
            }

            const newName = this.config.faucet.statusNames[status];
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
            this.log(`Current balance: ${balance}, Threshold: ${this.config.faucet.threshold}`);
            await this.updateChannelName(newStatus);
            this.currentStatus = newStatus;
        }
    }

    async start() {
        this.log('Starting faucet monitoring...');
        this.log(`Faucet configuration: Channel ID: ${this.config.faucet.channelId}, Threshold: ${this.config.faucet.threshold}, Interval: ${this.config.faucet.fetchInterval}ms`);
        
        // Perform initial check
        await this.checkFaucetStatus();

        // Set up interval for periodic checks
        setInterval(() => this.checkFaucetStatus(), this.config.faucet.fetchInterval);
    }
}

module.exports = Faucet;