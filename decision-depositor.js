const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady } = require('@polkadot/util-crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Network configurations
const networks = {
  polkadot: {
    name: 'Polkadot',
    wsEndpoint: process.env.POLKADOT_RPC_ENDPOINT || 'wss://rpc.polkadot.io',
    accountSeed: process.env.POLKADOT_ACCOUNT_SEED || process.env.ACCOUNT_SEED || '//Alice',
    ss58Address: process.env.POLKADOT_SS58_ADDRESS || process.env.SS58_ADDRESS,
    trackId: process.env.POLKADOT_TRACK_ID || process.env.TRACK_ID || '30',
    placeDeposits: process.env.POLKADOT_PLACE_DEPOSITS === 'true' || process.env.PLACE_DEPOSITS === 'true'
  },
  kusama: {
    name: 'Kusama',
    wsEndpoint: process.env.KUSAMA_RPC_ENDPOINT || 'wss://kusama-rpc.polkadot.io',
    accountSeed: process.env.KUSAMA_ACCOUNT_SEED || process.env.ACCOUNT_SEED || '//Alice',
    ss58Address: process.env.KUSAMA_SS58_ADDRESS || process.env.SS58_ADDRESS,
    trackId: process.env.KUSAMA_TRACK_ID || process.env.TRACK_ID || '30',
    placeDeposits: process.env.KUSAMA_PLACE_DEPOSITS === 'true' || process.env.PLACE_DEPOSITS === 'true'
  }
};

// Determine which networks to run
const targetNetworks = process.env.NETWORKS ? process.env.NETWORKS.split(',') : ['polkadot', 'kusama'];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Write results to log file
function writeToLog(network, message) {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const logPath = path.join(logDir, `${network}-${dateStr}.log`);
  
  fs.appendFileSync(logPath, `[${date.toISOString()}] ${message}\n`);
  console.log(message);
}

async function processNetwork(networkKey) {
  const networkConfig = networks[networkKey];
  
  writeToLog(networkKey, `\n==== PROCESSING ${networkConfig.name.toUpperCase()} ====`);
  writeToLog(networkKey, `Connecting to ${networkConfig.wsEndpoint}...`);
  
  try {
    await cryptoWaitReady();
    
    // Initialize the API
    const api = await ApiPromise.create({
      provider: new WsProvider(networkConfig.wsEndpoint)
    });
    
    const [chain, nodeName, nodeVersion] = await Promise.all([
      api.rpc.system.chain(),
      api.rpc.system.name(),
      api.rpc.system.version()
    ]);
    
    const token_decimals = await api.registry.chainDecimals[0];
    
    // Set up the signer
    const keyring = new Keyring({ type: 'sr25519' });
    const signer = keyring.addFromUri(networkConfig.accountSeed);
    
    writeToLog(networkKey, '\n--- ACCOUNT ---');
    writeToLog(networkKey, `Connected to chain: ${chain}`);
    writeToLog(networkKey, `Signer address: ${signer.address}`);
    
    if (networkConfig.ss58Address && signer.address !== networkConfig.ss58Address) {
      writeToLog(networkKey, `⚠️ Warning: The address generated from the seed (${signer.address}) doesn't match the provided SS58 address (${networkConfig.ss58Address})`);
    }
    
    // Get account balance
    const { data: balance } = await api.query.system.account(signer.address);
    writeToLog(networkKey, `Account balance: ${balance.free / Math.pow(10, token_decimals)} (free), ${balance.reserved / Math.pow(10, token_decimals)} (reserved)`);
    
    // Set the smalltipper track ID
    const smalltipperTrackId = networkConfig.trackId;
    writeToLog(networkKey, `Using track ID: ${smalltipperTrackId}`);
    
    // Get all referenda
    writeToLog(networkKey, '\nGetting all referenda...');
    
    if (!api.query.referenda.referendumInfoFor) {
      writeToLog(networkKey, 'Cannot find referendumInfoFor query method. API structure may have changed.');
      await api.disconnect();
      return;
    }
    
    const referendaEntries = await api.query.referenda.referendumInfoFor.entries();
    writeToLog(networkKey, `Total referenda found: ${referendaEntries.length}`);
    
    // Process all referenda to find those of interest
    const allReferenda = [];
    const noDepositReferenda = [];
    
    writeToLog(networkKey, '\nAnalyzing active referendums');
    
    for (const [key, value] of referendaEntries) {
      try {
        const referendumIndex = key.args[0].toNumber();
        const referendumInfo = value.toHuman();
        
        // Skip referenda that are not ongoing
        if (!referendumInfo || !referendumInfo.Ongoing) {
          continue;
        }
        
        const ongoingInfo = referendumInfo.Ongoing;
        
        // Check if this referendum is on our target track
        const isTargetTrack = ongoingInfo.track == smalltipperTrackId;
        
        // Check if it has a decision deposit
        const hasDecisionDeposit = !!ongoingInfo.decisionDeposit;
        
        allReferenda.push({
          index: referendumIndex,
          track: ongoingInfo.track,
          isTargetTrack: isTargetTrack,
          hasDecisionDeposit: hasDecisionDeposit,
          submittedBy: ongoingInfo.submissionDeposit.who || 'unknown',
          inDeciding: !!ongoingInfo.deciding
        });
        
        if (isTargetTrack && !hasDecisionDeposit) {
          writeToLog(networkKey, `Found target referendum #${referendumIndex} without decision deposit`);
          noDepositReferenda.push({
            index: referendumIndex,
            track: ongoingInfo.track,
            submittedBy: ongoingInfo.submissionDeposit.who || 'unknown'
          });
        }
      } catch (err) {
        writeToLog(networkKey, `Error processing referendum at index ${key.args[0].toNumber()}: ${err.message}`);
      }
    }
    
    writeToLog(networkKey, '\n--- SUMMARY ---');
    writeToLog(networkKey, `Total ongoing Referendums: ${allReferenda.length}`);
    writeToLog(networkKey, `Referendums on track ${smalltipperTrackId}: ${allReferenda.filter(r => r.isTargetTrack).length}`);
    writeToLog(networkKey, `Referendums without decision deposits (all tracks): ${allReferenda.filter(r => !r.hasDecisionDeposit).length}`);
    writeToLog(networkKey, `Referendums without decision deposits: ${noDepositReferenda.length}`);
    
    if (noDepositReferenda.length > 0) {
      writeToLog(networkKey, '\nReferenda without decision deposits that need action:');
      noDepositReferenda.forEach(ref => {
        writeToLog(networkKey, `- Referendum #${ref.index}, Submitted by: ${ref.submittedBy}`);
      });
      
      writeToLog(networkKey, '\nReferendum indices that need deposits (use this for batch operations):');
      writeToLog(networkKey, noDepositReferenda.map(r => r.index).join(', '));
      
      if (networkConfig.placeDeposits) {
        writeToLog(networkKey, '\nPlacing decision deposits...');
        writeToLog(networkKey, `Account that will place deposits: ${signer.address}`);
        
        // Process each referendum that needs a deposit
        const results = [];
        
        for (const referendum of noDepositReferenda) {
          try {
            writeToLog(networkKey, `\nPlacing deposit for referendum #${referendum.index}...`);
            
            // Create the transaction
            const tx = api.tx.referenda.placeDecisionDeposit(referendum.index);
            
            // Sign and send the transaction
            const txPromise = new Promise((resolve, reject) => {
              let unsubscribe;
              
              tx.signAndSend(signer, async (result) => {
                writeToLog(networkKey, `Current status: ${result.status.type}`);
                
                if (result.status.isInBlock || result.status.isFinalized) {
                  // Check for success or failure in events
                  let success = true;
                  let errorMessage = '';
                  
                  result.events.forEach(({ event }) => {
                    if (api.events.system.ExtrinsicFailed.is(event)) {
                      success = false;
                      const { dispatchError } = event.data;
                      if (dispatchError.isModule) {
                        try {
                          const decoded = api.registry.findMetaError(dispatchError.asModule);
                          errorMessage = `${decoded.section}.${decoded.name}`;
                        } catch (e) {
                          errorMessage = 'Unknown error';
                        }
                      } else {
                        errorMessage = dispatchError.toString();
                      }
                    }
                  });
                  
                  if (unsubscribe) {
                    unsubscribe();
                  }
                  
                  if (success) {
                    writeToLog(networkKey, `✅ Successfully placed deposit for referendum #${referendum.index}`);
                    resolve({
                      index: referendum.index,
                      success: true,
                      block: result.status.isFinalized 
                        ? result.status.asFinalized.toString() 
                        : result.status.asInBlock.toString(),
                      hash: tx.hash.toString()
                    });
                  } else {
                    writeToLog(networkKey, `❌ Failed to place deposit for referendum #${referendum.index}: ${errorMessage}`);
                    reject(new Error(errorMessage));
                  }
                } else if (result.status.isDropped || result.status.isInvalid || result.status.isUsurped) {
                  if (unsubscribe) {
                    unsubscribe();
                  }
                  reject(new Error(`Transaction failed with status: ${result.status.type}`));
                }
              }).then(unsub => {
                unsubscribe = unsub;
              }).catch(error => {
                reject(error);
              });
            });
            
            try {
              const result = await txPromise;
              results.push(result);
            } catch (err) {
              writeToLog(networkKey, `Transaction error: ${err.message}`);
              results.push({
                index: referendum.index,
                success: false,
                error: err.message
              });
            }
            
            // Add a delay between transactions to avoid nonce issues
            writeToLog(networkKey, 'Waiting 10 seconds before next transaction...');
            await sleep(10000);
            
          } catch (err) {
            writeToLog(networkKey, `Error processing referendum #${referendum.index}: ${err.message}`);
            results.push({
              index: referendum.index,
              success: false,
              error: err.message
            });
          }
        }
        
        // Display final results
        writeToLog(networkKey, '\n--- DEPOSIT PLACEMENT RESULTS ---');
        writeToLog(networkKey, `Total attempted: ${results.length}`);
        writeToLog(networkKey, `Successful: ${results.filter(r => r.success).length}`);
        writeToLog(networkKey, `Failed: ${results.filter(r => !r.success).length}`);
        
        if (results.filter(r => !r.success).length > 0) {
          writeToLog(networkKey, '\nFailed deposits:');
          results.filter(r => !r.success).forEach(r => {
            writeToLog(networkKey, `- Referendum #${r.index}: ${r.error || 'Unknown error'}`);
          });
        }
      } else {
        writeToLog(networkKey, '\n⚠️ PLACE_DEPOSITS is set to false. No deposits will be placed.');
        writeToLog(networkKey, 'To place deposits automatically, set PLACE_DEPOSITS=true in your .env file or when running the script.');
      }
      
    } else {
      writeToLog(networkKey, '\nNo referenda currently need decision deposits.');
    }
    
    // Disconnect from the API
    writeToLog(networkKey, '\nDisconnecting from the node...');
    await api.disconnect();
    
  } catch (error) {
    writeToLog(networkKey, `Error in script: ${error.message}`);
    
    if (error.stack) {
      writeToLog(networkKey, `Stack trace: ${error.stack}`);
    }
  }
}

async function main() {
  console.log(`Starting decision deposit placer for networks: ${targetNetworks.join(', ')}`);
  
  // Process each network sequentially
  for (const network of targetNetworks) {
    if (networks[network]) {
      await processNetwork(network);
    } else {
      console.error(`Unknown network: ${network}`);
    }
  }
  
  console.log("All networks processed. Exiting.");
  process.exit(0);
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});