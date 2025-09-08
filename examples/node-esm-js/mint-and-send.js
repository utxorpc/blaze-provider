// Example: Mint native assets and send them in a single transaction (ESM)
import {
  Bip32PrivateKey,
  mnemonicToEntropy,
  NetworkId,
  wordlist,
  AssetName,
  NativeScript,
  ScriptPubkey,
  Ed25519KeyHashHex,
} from "@blaze-cardano/core";
import { HotWallet, Core, Blaze } from "@blaze-cardano/sdk";
import { makeValue } from "@blaze-cardano/tx";
import { U5C } from "@utxorpc/blaze-provider";

async function main() {
  // Step #1: Create U5C provider
  const provider = new U5C({
    url: "http://localhost:50051",
    network: NetworkId.Testnet,
  });

  // Step #2: Create wallet from mnemonic
  const mnemonic =
    "end link visit estate sock hurt crucial forum eagle earn idle laptop wheat rookie when hard suffer duty kingdom clerk glide mechanic debris jar";
  const entropy = mnemonicToEntropy(mnemonic, wordlist);
  const masterkey = Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy), "");
  const wallet = await HotWallet.fromMasterkey(masterkey.hex(), provider);

  // Step #3: Create Blaze instance
  const blaze = await Blaze.from(provider, wallet);

  console.log("Wallet address:", wallet.address.toBech32());
  console.log("Wallet balance:", (await wallet.getBalance()).toCore());

  // Step #4: Create signature-based native script
  const paymentKeyHash = wallet.address.asBase().getPaymentCredential().hash;
  console.log("Payment Key Hash:", paymentKeyHash);
  
  // Convert to the correct type
  const ed25519KeyHash = Ed25519KeyHashHex(paymentKeyHash.toString());
  
  // Create ScriptPubkey first, then use proper constructor
  const scriptPubkey = new ScriptPubkey(ed25519KeyHash);
  
  // Create native script using the proper static method
  const nativeScript = NativeScript.newScriptPubkey(scriptPubkey);
  const script = Core.Script.newNativeScript(nativeScript);
  const policyId = Core.PolicyId(script.hash());

  // Step #5: Define the assets to mint
  const assetName1 = AssetName(Buffer.from("SimpleToken", "utf8").toString("hex"));
  const mintAmount = 1000n;

  console.log("Policy ID:", policyId.toString());
  console.log("Asset Name (hex):", assetName1.toString());
  console.log("Minting amount:", mintAmount.toString());

  // Step #6: Create recipient address
  const recipientAddress = Core.Address.fromBech32(
    "addr_test1qrnrqg4s73skqfyyj69mzr7clpe8s7ux9t8z6l55x2f2xuqra34p9pswlrq86nq63hna7p4vkrcrxznqslkta9eqs2nsmlqvnk"
  );

  // Step #7: Build the transaction that mints and sends assets
  try {
    const tx = await blaze
      .newTransaction()
      // Mint the tokens - native scripts don't need redeemers
      .addMint(
        policyId,
        new Map([[assetName1, mintAmount]])
        // No redeemer needed for native scripts!
      )
      // Send some ADA to recipient
      .payLovelace(recipientAddress, 2_000_000n)
      // Send some of the freshly minted tokens to recipient
      .payAssets(
        recipientAddress,
        makeValue(0n, [Core.AssetId.fromParts(policyId, assetName1).toString(), 500n])
      )
      // Provide the policy script as witness
      .provideScript(script)
      .complete();

    console.log("Transaction built successfully");
    console.log("Transaction size:", tx.toCbor().length / 2, "bytes");

    // Step #8: Sign the transaction
    const signedTx = await blaze.signTransaction(tx);
    console.log("Transaction signed");

    // Step #9: Submit the transaction
    const txId = await blaze.provider.postTransactionToChain(signedTx);
    console.log("🎉 Transaction submitted successfully!");
    console.log("Transaction ID:", txId);
    console.log("✅ Minted:", mintAmount, "SimpleTokens");
    console.log("✅ Sent 500 SimpleTokens + 2 ADA to recipient");
  } catch (error) {
    console.error("❌ Transaction failed:", error);
  }
}

main().catch(console.error);