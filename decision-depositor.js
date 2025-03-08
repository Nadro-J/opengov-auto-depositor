const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady } = require('@polkadot/util-crypto');
require('dotenv').config();

// Parse track IDs from environment variables
function parseTrackIds(trackString) {
  if (!trackString) return [30]; // Default track ID
  return trackString.split(',').map(id => id.trim());
}

// Network configurations
const networks = {
  polkadot: {
    name: 'Polkadot',
    wsEndpoint: process.env.POLKADOT_RPC_ENDPOINT || 'wss://rpc.polkadot.io',
    accountSeed: process.env.POLKADOT_ACCOUNT_SEED || process.env.ACCOUNT_SEED || '//Alice',
    ss58Address: process.env.POLKADOT_SS58_ADDRESS || process.env.SS58_ADDRESS,
    trackIds: parseTrackIds(process.env.POLKADOT_TRACK_IDS || process.env.TRACK_IDS || '30'),
    placeDeposits: process.env.POLKADOT_PLACE_DEPOSITS === 'true' || process.env.PLACE_DEPOSITS === 'true'
  },
  kusama: {
    name: 'Kusama',
    wsEndpoint: process.env.KUSAMA_RPC_ENDPOINT || 'wss://kusama-rpc.polkadot.io',
    accountSeed: process.env.KUSAMA_ACCOUNT_SEED || process.env.ACCOUNT_SEED || '//Alice',
    ss58Address: process.env.KUSAMA_SS58_ADDRESS || process.env.SS58_ADDRESS,
    trackIds: parseTrackIds(process.env.KUSAMA_TRACK_IDS || process.env.TRACK_IDS || '30'),
    placeDeposits: process.env.KUSAMA_PLACE_DEPOSITS === 'true' || process.env.PLACE_DEPOSITS === 'true'
  }
};

// Determine which networks to run
const targetNetworks = process.env.NETWORKS ? process.env.NETWORKS.split(',').map(n => n.trim()) : ['polkadot', 'kusama'];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processNetwork(networkKey) {
  const networkConfig = networks[networkKey];
  
  try {
    await cryptoWaitReady();
    
    // Initialize the API
    const api = await ApiPromise.create({
      provider: new WsProvider(networkConfig.wsEndpoint),
      noInitWarn: true
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
  
    
    if (networkConfig.ss58Address && signer.address !== networkConfig.ss58Address) {
      console.log(`⚠️ Warning: The address generated from the seed (${signer.address}) doesn't match the provided SS58 address (${networkConfig.ss58Address})`);
    }

    const { data: balance } = await api.query.system.account(signer.address);
    const trackIds = networkConfig.trackIds;

    const accountData = {
      "Connected to chain": String(chain),
      "Signer address": signer.address ,
      "Account balance (free)": balance.free / Math.pow(10, token_decimals) ,
      "Account balance (reserved)": balance.reserved / Math.pow(10, token_decimals),
      "Target track IDs": trackIds.join(', ')
    };

  console.table(accountData);
    // Get all referenda
    console.log('Getting all referenda...');
    
    if (!api.query.referenda.referendumInfoFor) {
      console.log('Cannot find referendumInfoFor query method. API structure may have changed.');
      await api.disconnect();
      return;
    }
    const referendaEntries = await api.query.referenda.referendumInfoFor.entries();

    // Process all referenda to find those of interest
    const allReferenda = [];
    const noDepositReferenda = [];
    
    console.log('Analyzing active referendums...');
    
    for (const [key, value] of referendaEntries) {
      try {
        const referendumIndex = key.args[0].toNumber();
        const referendumInfo = value.toHuman();
        
        // Skip referenda that are not ongoing
        if (!referendumInfo || !referendumInfo.Ongoing) {
          continue;
        }
        
        const ongoingInfo = referendumInfo.Ongoing;
        
        // Check if this referendum is on one of our target tracks
        const trackId = ongoingInfo.track;
        const isTargetTrack = trackIds.includes(trackId) || trackIds.includes(trackId.toString());
        
        // Check if it has a decision deposit
        const hasDecisionDeposit = !!ongoingInfo.decisionDeposit;
        
        allReferenda.push({
          index: referendumIndex,
          track: trackId,
          isTargetTrack,
          hasDecisionDeposit,
          submittedBy: ongoingInfo.submissionDeposit.who || 'unknown',
          inDeciding: !!ongoingInfo.deciding
        });
        
        if (isTargetTrack && !hasDecisionDeposit) {
          noDepositReferenda.push({
            index: referendumIndex,
            track: trackId,
            submittedBy: ongoingInfo.submissionDeposit.who || 'unknown'
          });
        }
      } catch (err) {
        console.log(`Error processing referendum at index ${key.args[0].toNumber()}: ${err.message}`);
      }
    }

    const referendumStats = {
      "Total ongoing referendums": allReferenda.length,
      "Referendums without decision deposits (all tracks)": allReferenda.filter(r => !r.hasDecisionDeposit).length,
      "Referendums on all target tracks": allReferenda.filter(r => r.isTargetTrack).length,
      "Target referendums without decision deposits": noDepositReferenda.length
      };

      console.table(referendumStats);
    
    if (noDepositReferenda.length > 0) {
      console.log('Referenda without decision deposits that need action:');
      noDepositReferenda.forEach(ref => {
        console.log(`📌 Referendum #${ref.index} (Track ${ref.track}), Submitted by: ${ref.submittedBy}`);
      });
      
      if (networkConfig.placeDeposits) {
        console.log('\nPlacing decision deposits...');
        console.log(`Account that will place deposits: ${signer.address}`);
        
        // Process each referendum that needs a deposit
        const results = [];
        
        for (const referendum of noDepositReferenda) {
          try {
            console.log(`\nPlacing deposit for referendum #${referendum.index} (Track ${referendum.track})...`);
            
            // Create the transaction
            const tx = api.tx.referenda.placeDecisionDeposit(referendum.index);
            
            // Sign and send the transaction
            const txPromise = new Promise((resolve, reject) => {
              let unsubscribe;
              
              tx.signAndSend(signer, async (result) => {
                console.log(`Current status: ${result.status.type}`);
                
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
                    console.log(`✅ Successfully placed deposit for referendum #${referendum.index} (Track ${referendum.track})`);
                    resolve({
                      index: referendum.index,
                      track: referendum.track,
                      success: true,
                      block: result.status.isFinalized 
                        ? result.status.asFinalized.toString() 
                        : result.status.asInBlock.toString(),
                      hash: tx.hash.toString()
                    });
                  } else {
                    console.log(`❌ Failed to place deposit for referendum #${referendum.index} (Track ${referendum.track}): ${errorMessage}`);
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
              console.log(`Transaction error: ${err.message}`);
              results.push({
                index: referendum.index,
                track: referendum.track,
                success: false,
                error: err.message
              });
            }
            
            // Add a delay between transactions to avoid nonce issues
            console.log('🕞 Waiting 10 seconds before next transaction...');
            await sleep(10000);
            
          } catch (err) {
            console.log(`Error processing referendum #${referendum.index}: ${err.message}`);
            results.push({
              index: referendum.index,
              track: referendum.track,
              success: false,
              error: err.message
            });
          }
        }

        const extrinsicStats = {
          "Total attempted": results.length,
          "Successful": results.filter(r => r.success).length,
          "Failed": results.filter(r => !r.success).length
          };
    
        console.table(extrinsicStats);
        

        if (results.filter(r => !r.success).length > 0) {
          console.log('Failed deposits:');
          results.filter(r => !r.success).forEach(r => {
            console.log(`- Referendum #${r.index} (Track ${r.track}): ${r.error || 'Unknown error'}`);
          });
        }
      } else {
        console.log('\n⚠️ PLACE_DEPOSITS is set to false. No deposits will be placed.');
        console.log('To place deposits automatically, set PLACE_DEPOSITS=true in your .env file or when running the script.');
      }
      
    } else {
      console.log('\nNo referenda currently need decision deposits.');
    }
    
    // Disconnect from the API
    console.log('Disconnecting from the node...\n\n');
    await api.disconnect();
    
  } catch (error) {
    console.log(`Error in script: ${error.message}`);
    
    if (error.stack) {
      console.log(`Stack trace: ${error.stack}`);
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