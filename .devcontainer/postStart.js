import { execSync } from 'child_process';
import fs from 'fs';

// Helper function to run shell commands and log output
function runCommand(command, successMessage, errorMessage) {
	try {
		execSync(command, { stdio: 'inherit' });
		if (successMessage) {
			logWithColor(successMessage, 'green');
		}
	} catch (error) {
		switch (errorMessage) {
			case null: {
				break;
			}
			case undefined: {
				console.error(error);
				break;
			}
			default: {
				logWithColor(errorMessage, 'red');
				break;
			}
		}
	}
}

// Function to log with color based on platform
function logWithColor(message, color = 'default') {
	const isWindows = process.platform === 'win32';

	if (isWindows && process.env.POWERSHELL_EXECUTION_POLICY) {
		// PowerShell: Use Write-Host with -ForegroundColor
		const colors = {
			red: 'Red',
			yellow: 'Yellow',
			green: 'Green',
			default: '', // Default terminal color
			reset: '',
		};

		if (colors[color]) {
			console.log(`Write-Host '${message}' -ForegroundColor ${colors[color]}`);
		} else {
			console.log(`Write-Host '${message}'`);
		}
	} else {
		// Unix-based (Linux/Mac): Use ANSI escape codes
		const colorCodes = {
			red: '\x1b[31m',
			yellow: '\x1b[33m',
			green: '\x1b[32m',
			reset: '\x1b[0m',
			default: '', // Default terminal color
		};

		if (colorCodes[color]) {
			console.log(`${colorCodes[color]}${message}${colorCodes.reset}`);
		} else {
			console.log(message); // Use the default terminal color if no color is specified
		}
	}
}

console.log('Starting postStart tasks...');

// 1. Configure git settings
runCommand(
	'git config --global core.autocrlf input',
	'Git config completed successfully',
	'Error: Git config failed',
);

// 2. Install dependencies if `pnpm-lock.yaml` exists
const pnpmLockFile = 'pnpm-lock.yaml';
if (fs.existsSync(pnpmLockFile)) {
	try {
		execSync('pnpm install', { stdio: 'inherit' });
		logWithColor('pnpm install was successful', 'green');
	} catch (error) {
		logWithColor('Error: pnpm install failed', 'red');
		logWithColor(error);
	}
} else {
	logWithColor(
		'Warning: pnpm-lock.yaml not found, skipping pnpm install',
		'yellow',
	);
}

// 3. Handle SSH key copy
const sshKeyPath = '/mnt/ssh_keys/id_rsa';
if (fs.existsSync(sshKeyPath)) {
	try {
		execSync(`sudo cp ${sshKeyPath} /root/.ssh`, { stdio: 'inherit' });
		logWithColor('SSH key copied to /root/.ssh/id_rsa', 'green');
	} catch (error) {
		logWithColor('Error: Failed to copy SSH key to /root/.ssh/id_rsa', 'red');
		logWithColor(error);
	}
} else {
	logWithColor('Warning: SSH key not found, skipping copy', 'yellow');
}

// 4. Handle CA certificate copy
const caCertPath = '/mnt/ca_certificates/rootCA.crt';
if (fs.existsSync(caCertPath)) {
	try {
		execSync(`sudo cp ${caCertPath} /usr/local/share/ca-certificates`, {
			stdio: 'inherit',
		});
		logWithColor(
			'CA certificate copied to /usr/local/share/ca-certificates/rootCA.crt',
			'green',
		);

		try {
			execSync('sudo update-ca-certificates', { stdio: 'inherit' });
			logWithColor('CA certificate updated', 'green');
		} catch (error) {
			logWithColor('Error: Failed to update CA certificates', 'red');
			logWithColor(error);
		}
	} catch (error) {
		logWithColor(
			'Error: Failed to copy CA certificate to /usr/local/share/ca-certificates',
			'red',
		);
		logWithColor(error);
	}
} else {
	logWithColor(
		'Warning: CA certificate not found, skipping copy and update-ca-certificates',
		'yellow',
	);
}

// 5. Run pnpm outdated to check for outdated dependencies
if (fs.existsSync(pnpmLockFile)) {
	try {
		execSync('pnpm outdated', { stdio: 'inherit' });
		logWithColor('pnpm outdated completed successfully', 'green');
	} catch (error) {
		// If the error is due to outdated dependencies (exit code 1), treat it as a warning, not a failure
		if (error.status === 1) {
			// Do nothing
			// We could also log a warning here, but I do not need that, it is already very visible, that dependencies are outdated
		} else {
			logWithColor('Error: pnpm outdated failed', 'red');
		}
	}
} else {
	logWithColor(
		'Warning: pnpm-lock.yaml not found, skipping pnpm outdated',
		'yellow',
	);
}
