// Example: Mint native assets using a Plutus script
import {
  Bip32PrivateKey,
  mnemonicToEntropy,
  NetworkId,
  wordlist,
  AssetName,
  PlutusData,
  PlutusV3Script,
  HexBlob,
  Ed25519KeyHashHex,
  ConstrPlutusData,
  PlutusList,
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

  // Step #4: Your compiled Aiken signature-validating script
  const plutusScriptCbor = HexBlob("59018a01010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cc0200092225980099b8748000c01cdd500144c96600266e1d2000300837540091323259800980780145660026466446600400400244b30010018a508acc004cdc79bae30110010038a518998010011809000a018403c6eb0c03cc040c040c040c040c040c040c040c040c030dd50029bae300e300b375400d1337109000194c00400664b30013370e900118061baa0018a5eb7bdb18226eacc040c034dd5000a0163233001001375660206022602260226022601a6ea8018896600200314c103d87a8000899192cc004cdc8804000c56600266e3c020006266e9520003301230100024bd7045300103d87a80004039133004004301400340386eb8c038004c04400500f520004004444b30010028800c4ca600200930130039919b80003375a60200046eb8c0380050041808801201e8a5040251640306eb8c034004c024dd50024590071bae300b3008375400514a08030601000260066ea802229344d9590011");
  
  const plutusScript = new PlutusV3Script(plutusScriptCbor);
  const script = Core.Script.newPlutusV3Script(plutusScript);
  const policyId = Core.PolicyId(script.hash());

  console.log("Policy ID:", policyId.toString());

  // Step #5: Define the assets to mint
  const assetName = AssetName(Buffer.from("PlutusToken", "utf8").toString("hex"));
  const mintAmount = 1000n;

  console.log("Asset Name (hex):", assetName.toString());
  console.log("Minting amount:", mintAmount.toString());

  // Step #6: Create recipient address
  const recipientAddress = Core.Address.fromBech32(
    "addr_test1qrnrqg4s73skqfyyj69mzr7clpe8s7ux9t8z6l55x2f2xuqra34p9pswlrq86nq63hna7p4vkrcrxznqslkta9eqs2nsmlqvnk"
  );

  // Step #7: Create redeemer matching your Aiken script's MintingRedeemer type
  // Your script expects: Mint { owner: ByteArray }
  const paymentKeyHash = wallet.address.asBase()!.getPaymentCredential().hash;
  
  // Create proper ConstrPlutusData matching the exact type structure
  const ownerBytes = Buffer.from(paymentKeyHash, 'hex');
  const redeemer = PlutusData.fromCore({
    constructor: 0n, // Mint constructor
    fields: {
      items: [ownerBytes] // PlutusList with items array containing owner
    }
  });

  // Step #8: Build the transaction
  try {
    const tx = await blaze
      .newTransaction()
      // Mint tokens using Plutus script
      .addMint(
        policyId,
        new Map([[assetName, mintAmount]]),
        redeemer // Required for Plutus scripts
      )
      // Send some ADA to recipient
      .payLovelace(recipientAddress, 2_000_000n)
      // Send some minted tokens to recipient
      .payAssets(
        recipientAddress,
        makeValue(0n, [Core.AssetId.fromParts(policyId, assetName).toString(), 500n])
      )
      // Add your wallet as required signer (for extra_signatories check)
      .addRequiredSigner(Ed25519KeyHashHex(paymentKeyHash.toString()))
      // Provide the Plutus script
      .provideScript(script)
      .complete();

    console.log("Transaction built successfully");
    console.log("Transaction size:", tx.toCbor().length / 2, "bytes");

    // Step #9: Sign the transaction
    const signedTx = await blaze.signTransaction(tx);
    console.log("Transaction signed");

    // Step #10: Submit the transaction
    const txId = await blaze.provider.postTransactionToChain(signedTx);
    console.log("🎉 Plutus minting transaction successful!");
    console.log("Transaction ID:", txId);
    console.log("✅ Minted:", mintAmount, "PlutusTokens using Plutus script");
    console.log("✅ Sent 500 PlutusTokens + 2 ADA to recipient");
  } catch (error) {
    console.error("❌ Plutus minting failed:", error);
    console.log("This might be because:");
    console.log("1. The UTxO RPC node doesn't support Plutus script execution");
    console.log("2. The script needs proper compilation from Plutus/Aiken");
    console.log("3. Additional protocol parameters are required");
  }
}

main().catch(console.error);