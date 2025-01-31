const fetchBlockInfo = async () => {
    const url = "https://api.routescan.io/v2/network/testnet/evm/3636/blocks?count=false&sort=desc";

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.items && data.items.length > 0) {
            const latestBlock = data.items[0];
            const latestTimestamp = new Date(latestBlock.timestamp);
            const currentTime = new Date();

            const timeDifference = Math.abs(currentTime - latestTimestamp) / 1000; // difference in seconds

            console.log(`Latest Block Number: ${latestBlock.number}`);
            console.log(`Latest Timestamp: ${latestTimestamp}`);
            console.log(`Current Time: ${currentTime}`);
            console.log(`Time Difference: ${timeDifference} seconds`);
        }
    } catch (error) {
        console.error("Error fetching block info:", error);
    }
};

const startFetching = () => {
    fetchBlockInfo();
    setInterval(fetchBlockInfo, 60000); // fetch every minute (60000 milliseconds)
};

startFetching();