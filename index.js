import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs';

// Sleep function for delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to convert satoshis to BTC using string manipulation instead of deviding by 100000000.
// This approach is chosen to avoid potential floating-point arithmetic errors that can occur when dividing.
function satoshisToBTC(satoshis, removeTrailingZeros = true) {
	const satoshisStr = satoshis.toString();
	const length = satoshisStr.length;
	let btc;

	if (length <= 8) {
		btc = '0.' + satoshisStr.padStart(8, '0');
	} else {
		btc =
			satoshisStr.slice(0, length - 8) + '.' + satoshisStr.slice(length - 8);
	}

	if (removeTrailingZeros) {
		btc = btc.replace(/0+$/, ''); // Remove trailing zeros
	}

	return btc;
}

// List of your addresses
// To obtain all addresses from your Electrum wallet, run the following command in the Electrum Console:
// listaddresses()
// Enter your addresses in data/addresses.txt
const myAddresses = (() => {
	const fileContent = fs.readFileSync('data/addresses.txt', 'utf8');
	return fileContent
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
})();

// List of transaction hashes to look up
// You can easily obtain transaction hashes via Electrum:
// Electrum
// -> History
// -> At the top right corner click the "tools" looking icon
// -> Export
const transactionHashes = (() => {
	const fileContent = fs.readFileSync('data/transaction-ids.txt', 'utf8');
	return fileContent
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
})();

// Output CSV setup
const csvWriter = createObjectCsvWriter({
	path: 'output/transactions.csv',
	header: [
		{ id: 'id', title: 'Id' },
		{ id: 'txid', title: 'Transaction ID' },
		{ id: 'date', title: 'Date (UTC)' },
		{ id: 'amount', title: 'Amount (BTC)' },
		{ id: 'balance', title: 'Balance (BTC)' },
		{ id: 'fee', title: 'Fee (BTC)' },
		{ id: 'inputs', title: 'Inputs' },
		{ id: 'outputs', title: 'Outputs' },
		{ id: 'description', title: 'Description' },
	],
});

// Function to convert timestamp to UTC
// The timestamp parameter is a Unix timestamp (seconds since 1970-01-01 00:00:00 UTC).
function convertTimestampToUTC(timestamp) {
	const date = new Date(timestamp * 1000); // JavaScript’s Date constructor expects milliseconds, so we multiply by 1000 to convert seconds to milliseconds.
	return date.toISOString().replace('T', ' ').split('.')[0]; // Converts the Date object to an ISO 8601 string in UTC (YYYY-MM-DDTHH:MM:SS.sssZ). Before: "2025-03-29 13:52:22.123Z". After: "2025-03-29 13:52:22"
}

// Function to get transaction data from Blockchain.info API
async function getTransactionData(txid) {
	try {
		const response = await fetch(
			`https://blockchain.info/rawtx/${txid}?format=json`,
		);
		if (!response.ok) {
			throw new Error(
				`Error fetching data for transaction ${txid}: ${response.statusText}`,
			);
		}
		return await response.json();
	} catch (error) {
		console.error(error);
	}
}

// Function to get block data from Blockchain.info API
// This function is requred, because the rawtx API only returns the time when the transaction was broadcasted, but not when it was actually mined. The mined time we can obtain from this block-height API.
async function getBlockData(blockHeight) {
	try {
		const response = await fetch(
			`https://blockchain.info/block-height/${blockHeight}?format=json`,
		);
		if (!response.ok) {
			throw new Error(
				`Error fetching data for transaction ${blockHeight}: ${response.statusText}`,
			);
		}
		return await response.json();
	} catch (error) {
		console.error(error);
	}
}

// Function to process each transaction
async function processTransactions() {
	let rowId = 0;
	let balance = 0;
	const transactions = [];

	for (const txid of transactionHashes) {
		const txData = await getTransactionData(txid);
		await sleep(1000); // Sleep for 1 second between requests
		const blockData = await getBlockData(txData.block_height);
		await sleep(1000); // Sleep for 1 second between requests

		if (!txData) {
			continue;
		}

		let amount = 0;
		let fee = 0;
		let inputs = [];
		let outputs = [];
		let description = '';
		let hasOnlyExternalInputs = true;
		let inputSumOwnAddresses = 0;
		let outputSumOwnAddresses = 0;
		let inputSumAllAddresses = 0;
		let outputSumAllAddresses = 0;

		// Calculate amount for sending BTC as well as the inputs
		txData.inputs.forEach((input) => {
			const inputAddress = input.prev_out ? input.prev_out.addr : 'Input';
			const value = input.prev_out ? input.prev_out.value : 0;
			if (myAddresses.includes(inputAddress)) {
				inputSumOwnAddresses += value; // Sum inputs where your address is present
				inputs.push(`${inputAddress}: ${satoshisToBTC(value, false)} BTC`);
				hasOnlyExternalInputs = false;
			}
			inputSumAllAddresses += value; // Sum all inputs
		});
		amount -= inputSumOwnAddresses;

		// If there are only external inputs, replace contents of the input field with 'Multiple Inputs' or 'Input']
		if (hasOnlyExternalInputs) {
			inputs = txData.inputs.length > 1 ? ['Multiple Inputs'] : ['Input'];
		}

		// Calculate amount for receiving BTC as well as the outputs
		txData.out.forEach((output) => {
			const outputAddress = output.addr;
			const value = output.value;
			if (myAddresses.includes(outputAddress)) {
				outputSumOwnAddresses += value; // Sum outputs where your address is present
			}
			outputSumAllAddresses += value; // Sum all outputs

			// If inputs have only external addresses, only add outputs with your addresses
			// Othweise add all outputs
			if (!hasOnlyExternalInputs) {
				outputs.push(`${outputAddress}: ${satoshisToBTC(value, false)} BTC`);
			} else if (myAddresses.includes(outputAddress)) {
				outputs.push(`${outputAddress}: ${satoshisToBTC(value, false)} BTC`);
			}
		});
		amount += outputSumOwnAddresses;

		// If you received BTC, make the amount positive; if you sent BTC, it's negative
		const amountStr =
			amount >= 0
				? `+${satoshisToBTC(amount)}`
				: `-${satoshisToBTC(Math.abs(amount))}`;

		// Update the balance after each transaction
		balance += amount; // Add/subtract the amount from the current balance

		// Transaction fee (difference between inputs and outputs)
		fee = inputSumAllAddresses - outputSumAllAddresses;

		// Construct row for CSV
		const transactionRow = {
			id: rowId++,
			txid: txid,
			date: convertTimestampToUTC(blockData.blocks[0].time), // txData.time is actually the time when the transaction was broadcasted. blockData.blocks[0].time is the time when it was mined.
			amount: amountStr,
			balance: balance === 0 ? '0.' : satoshisToBTC(balance),
			fee: satoshisToBTC(fee, false),
			inputs: inputs.join(',\n'),
			outputs: outputs.join(',\n'),
			description: '', // You can add additional logic here if needed
		};

		transactions.push(transactionRow);
	}

	// Reverse the transactions array before writing to the CSV
	transactions.reverse();

	// Write data to CSV file
	await csvWriter.writeRecords(transactions);
	console.log('CSV file written successfully!');
}

// Run the script
processTransactions();
