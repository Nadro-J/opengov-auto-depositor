# OpenGov Auto Decision Depositor

Places decision deposits on smalltipper referenda in Polkadot and other Substrate-based chains using OpenGov.

## Features

- Scans for smalltipper referenda without decision deposits
- Automatically places decision deposits using a configured account
- Detailed logging and error reporting
- Compatible with Polkadot, Kusama, and other chains using OpenGov

## Prerequisites

- Node.js (v14 or later recommended)
- NPM (comes with Node.js)
- Access to a wallet with sufficient funds for deposits

## Installation
   ```bash
   npm install
   ```

## Configuration

Create a `.env` file in the root directory with your configuration:

```bash
# Copy the example configuration
cp .env.example .env
```

Then edit the `.env` file and set your values:

```yaml
# Network selection (comma-separated list: 'polkadot', 'kusama', or both)
NETWORKS=polkadot,kusama

# Global settings (used as fallback if network-specific ones are not set)
# 
# Your account's seed phrase or mnemonic
# WARNING: This is sensitive information!
# Format can be mnemonic or //Alice style derivation path
ACCOUNT_SEED=''
# Optional: Your SS58 address for verification
# If provided, the script will check if it matches the address generated from the seed
SS58_ADDRESS=
# https://wiki.polkadot.network/docs/learn-polkadot-opengov-origins#origins-and-tracks-info
TRACK_ID=30
# Set to 'true' to actually place deposits, 'false' to just scan
PLACE_DEPOSITS=false

# Polkadot-specific settings
POLKADOT_RPC_ENDPOINT=wss://rpc.polkadot.io
POLKADOT_ACCOUNT_SEED=
POLKADOT_SS58_ADDRESS=
POLKADOT_TRACK_ID=30
POLKADOT_PLACE_DEPOSITS=false

# Kusama-specific settings
KUSAMA_RPC_ENDPOINT=wss://kusama-rpc.polkadot.io
KUSAMA_ACCOUNT_SEED=
KUSAMA_SS58_ADDRESS=
KUSAMA_TRACK_ID=30
KUSAMA_PLACE_DEPOSITS=false
```

**IMPORTANT SECURITY NOTE**: 
- Never commit your `.env` file to version control
- Keep your seed phrase secure
- The `.gitignore` file is already configured to exclude `.env` files

## Usage

Run the script with:

```bash
node decision-depositor.js
```

### Recommended Workflow

1. First run with `PLACE_DEPOSITS=false` to identify referenda that need deposits
2. Review the list of identified referenda
3. When ready to place deposits, set `PLACE_DEPOSITS=true` in `.env` and run again


## Customization

You can adjust the smalltipper track ID in `decision-depositor.js` if needed. By default, it's set to `32`.


## Running as a Scheduled Task

For automatic monitoring, you can set up a cron job:

```bash
# Example: Run every 4 hours
0 */4 * * * cd /path/to/polkadot-decision-depositor && node decision-depositor.js >> depositor.log 2>&1
```

## Troubleshooting

- **Connection Issues**: Verify your RPC endpoint is correct and accessible
- **Transaction Failures**: Check your account has sufficient funds for deposits
- **API Errors**: The Substrate runtime may have changed; check for updates to this tool
- **Node.js Version**: This tool requires Node.js v14 or later

## Security Considerations

- **Protect your seed phrase**: Never share your seed or include it in version control
- **Start with scan mode**: Always use `PLACE_DEPOSITS=false` first to verify before placing deposits
- **Use dedicated accounts**: Consider using a dedicated account with limited funds for safety