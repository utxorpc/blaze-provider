<div align="center">
  <h1 style="font-size: 3em;">Blaze UTxO RPC Provider 🚀</h1>
  <h4>A gRPC interface for Blaze Cardano transaction building library</h4>
</div>

<div align="center">

  ![Forks](https://img.shields.io/github/forks/utxorpc/blaze-provider.svg?style=social) 
  ![Stars](https://img.shields.io/github/stars/utxorpc/blaze-provider.svg?style=social) 
  ![Contributors](https://img.shields.io/github/contributors/utxorpc/blaze-provider.svg) 
  ![Issues](https://img.shields.io/github/issues/utxorpc/blaze-provider.svg) 
  ![Issues Closed](https://img.shields.io/github/issues-closed/utxorpc/blaze-provider.svg)
  <a href="https://www.npmjs.com/package/@utxorpc/blaze-provider">
    <img src="https://img.shields.io/npm/v/@utxorpc/blaze-provider.svg" alt="npm">
  </a>
</div>

This project provides a **UTxO RPC (u5c)** provider for use with the [Blaze](https://github.com/butaneprotocol/blaze-cardano)
transaction-building library. The provider allows JavaScript/TypeScript applications to interact with UTxO-based blockchains, such as **Cardano**, using the standardized UTxO RPC interface.

## 🌟 Overview

[Blaze](https://github.com/butaneprotocol/blaze-cardano) is a powerful library that simplifies the process of creating **Cardano transactions** and interacting with **Cardano smart contracts** using JavaScript/TypeScript. However, Blaze requires access to the blockchain's current state (UTxOs, protocol parameters, etc.) to build and sign transactions.

The **UTxO RPC (u5c)** provider enables Blaze to access this state in a standardized and efficient way via **gRPC**, using a compact and high-performance binary format.

## ✨ Features

- 🔗 **Standardized Interface**: Uses the UTxO RPC specification to ensure compatibility and interoperability across UTxO-based blockchains.
- ⚡️ **Performance Optimized**: Utilizes gRPC for efficient communication with blockchain nodes, reducing network overhead and message size.
- 🔧 **Flexible Provider Options**: Can be used with hosted services, local nodes like **Dolos**, or any UTxO RPC-compliant service.

## 📦 Installation

To install the UTxO RPC provider, use npm:

```bash
npm install @utxorpc/blaze-provider
```

You also need to install the **Blaze SDK** if you haven’t already:

```bash
npm install @blaze-cardano/sdk
```

## 💡 Basic Usage

Below is an example of how to use the UTxO RPC provider with Blaze to build and submit a transaction.

```javascript
// Step #1
// Import Blaze SDK and UTxO RPC provider
import {
    Bip32PrivateKey,
    mnemonicToEntropy,
    wordlist,
} from "@blaze-cardano/core";
import {
    HotWallet,
    Core,
    Blaze,
} from "@blaze-cardano/sdk";
import { U5C } from "@utxorpc/blaze-provider";

async function main() {

    // Step #2
    // Create a new U5C provider
    const provider = new U5C({
        url: "http://localhost:50051",
        headers: {
            "dmtr-api-key": "<api-key>",
        },
    });

    // Step #3
    // Create a new wallet from a mnemonic
    const mnemonic =
        "your 24-word mnemonic here";
    const entropy = mnemonicToEntropy(mnemonic, wordlist);
    const masterkey = Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy), "");
    const wallet = await HotWallet.fromMasterkey(masterkey.hex(), provider);

    // Step #4
    // Create a Blaze instance from the wallet and provider
    const blaze = await Blaze.from(provider, wallet);

    // Optional: Print the wallet address
    console.log("Wallet address", wallet.address.toBech32());

    // Optional: Print the wallet balance
    console.log("Wallet balance", (await wallet.getBalance()).toCore());

    // Step #5
    // Create an example transaction that sends 5 ADA to an address
    const tx = await blaze
        .newTransaction()
        .payLovelace(
            Core.Address.fromBech32(
                "addr_test1qrnrqg4s73skqfyyj69mzr7clpe8s7ux9t8z6l55x2f2xuqra34p9pswlrq86nq63hna7p4vkrcrxznqslkta9eqs2nsmlqvnk",
            ),
            5_000_000n,
        )
        .complete();

    // Step #6
    // Sign the transaction
    const signexTx = await blaze.signTransaction(tx);

    // Step #7
    // Submit the transaction to the blockchain network
    const txId = await blaze.provider.postTransactionToChain(signexTx);

    // Optional: Print the transaction ID
    console.log("Transaction ID", txId);
}

main().catch(console.error);
```

## 👥 Join the Conversation

If you want to discuss UTxO RPC or get involved in the community, join the **TxPipe Discord**! There's a dedicated channel for UTxO RPC where you can connect with other developers, share ideas, and get support.

👉 [Join the TxPipe Discord here!](https://discord.gg/nbkJdPnKHm) 💬

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
