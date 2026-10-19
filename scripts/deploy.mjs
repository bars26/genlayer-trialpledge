// Deploys contracts/trial_pledge.py to GenLayer Studio and prints the address.
//
//   node scripts/deploy.mjs

import { readFileSync } from "fs";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC = "https://studio.genlayer.com/api";
const account = createAccount(generatePrivateKey());
const client = createClient({ chain: studionet, endpoint: RPC, account });
const code = readFileSync(new URL("../contracts/trial_pledge.py", import.meta.url), "utf8");

const hash = await client.deployContract({ code, args: [], leaderOnly: false });
console.log("deploy tx", hash);
const receipt = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 120, interval: 5000 });
const lr = receipt?.consensus_data?.leader_receipt;
const first = Array.isArray(lr) ? lr[0] : lr;
if (first?.execution_result !== "SUCCESS") {
  console.error("deploy executed with", first?.execution_result, JSON.stringify(first?.result ?? {}).slice(0, 300));
  process.exit(1);
}
console.log("contract", receipt.data?.contract_address ?? receipt.to_address ?? receipt.recipient);
