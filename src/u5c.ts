import {
  ProtocolParameters,
  Transaction,
  Redeemers,
  TokenMap,
  CostModels,
  Address,
  Hash28ByteBase16,
  NetworkId,
  Redeemer,
  ExUnits,
  Slot,
  SLOT_CONFIG_NETWORK,
} from "@blaze-cardano/core";
import {
  TransactionUnspentOutput,
  AssetId,
  TransactionInput,
  DatumHash,
  PlutusData,
  TransactionId,
  TransactionOutput,
  HexBlob,
  Value,
  PolicyId,
  AssetName,
  Datum,
  Script,
  fromHex,
  toHex,
  PlutusLanguageVersion,
  hardCodedProtocolParams,
} from "@blaze-cardano/core";
import { Provider, findScriptRefInAddressUtxos } from "@blaze-cardano/query";
import { cborToScript } from "./utils";
import { CardanoQueryClient, CardanoSubmitClient } from "@utxorpc/sdk";
import { submit } from "@utxorpc/spec";
import type * as spec from "@utxorpc/spec";

export class U5C extends Provider {
  private queryClient: CardanoQueryClient;
  private submitClient: CardanoSubmitClient;
  constructor({
    url,
    headers,
    network
  }: {
    url: string;
    headers?: Record<string, string>;
    network: NetworkId;
  }) {
    const networkName = network === NetworkId.Mainnet ? "cardano-mainnet" : "cardano-preprod";
    super(network, networkName);
    this.queryClient = new CardanoQueryClient({
      uri: url,
      headers,
    });

    this.submitClient = new CardanoSubmitClient({
      uri: url,
      headers,
    });
  }

  private _bytesToBigInt(bytes: Uint8Array): bigint {
    if (bytes.length === 0) return 0n;
    return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  }

  private _rpcBigIntToNative(value?: spec.cardano.BigInt): bigint {
    if (!value || value.bigInt.case === undefined) return 0n;

    switch (value.bigInt.case) {
      case "int":
        return value.bigInt.value;
      case "bigUInt":
        return this._bytesToBigInt(value.bigInt.value);
      case "bigNInt":
        return -this._bytesToBigInt(value.bigInt.value);
      default:
        return 0n;
    }
  }

  private _rpcRatioToNumber(ratio?: spec.cardano.RationalNumber): number {
    if (!ratio) return NaN;
    return ratio.numerator / ratio.denominator;
  }

  async resolveScriptRef(script: Script | Hash28ByteBase16, address?: Address): Promise<TransactionUnspentOutput | undefined> {
    return findScriptRefInAddressUtxos(this, script, address);
  }

  async getParameters(): Promise<ProtocolParameters> {
    const rpcPParams = await this.queryClient.readParams();
    if (rpcPParams === undefined || rpcPParams === null) {
      throw new Error(`Error fetching protocol parameters`);
    }
    return this._rpcPParamsToCorePParams(rpcPParams);
  }

  async getUnspentOutputs(
    address: Address,
  ): Promise<TransactionUnspentOutput[]> {
    const utxoSearchResult = await this.queryClient.searchUtxosByAddress(
      new Uint8Array(Buffer.from(address.toBytes().toString(), "hex")),
    );

    const utxos = utxoSearchResult.map((item) => {
      const input = new TransactionInput(
        TransactionId(Buffer.from(item.txoRef.hash).toString("hex")),
        BigInt(item.txoRef.index),
      );

      const output = this._rpcTxOutToCoreTxOut(item.parsedValued! as spec.cardano.TxOutput);
      return new TransactionUnspentOutput(input, output);
    });

    return utxos;
  }

  async getUnspentOutputsWithAsset(
    address: Address,
    unit: AssetId,
  ): Promise<TransactionUnspentOutput[]> {
    const addressBytes = new Uint8Array(
      Buffer.from(address.toBytes().toString(), "hex"),
    );

    const unitBytes = new Uint8Array(Buffer.from(unit.toString(), "hex"));

    const utxoSearchResult =
      await this.queryClient.searchUtxosByAddressWithAsset(
        addressBytes,
        undefined,
        unitBytes,
      );

    return utxoSearchResult.map((item) => {
      const input = new TransactionInput(
        TransactionId(Buffer.from(item.txoRef.hash).toString("hex")),
        BigInt(item.txoRef.index),
      );

      const output = this._rpcTxOutToCoreTxOut(item.parsedValued! as spec.cardano.TxOutput);

      return new TransactionUnspentOutput(input, output);
    });
  }

  async getUnspentOutputByNFT(
    unit: AssetId,
  ): Promise<TransactionUnspentOutput> {
    const unitBytes = new Uint8Array(Buffer.from(unit.toString(), "hex"));
    const utxoSearchResult = await this.queryClient.searchUtxosByAsset(
      undefined,
      unitBytes,
    );

    if (utxoSearchResult.length <= 0) {
      throw new Error(`Error fetching unspent outputs`);
    }

    const item = utxoSearchResult[0];
    if (item === undefined || item === null) {
      throw new Error(`Error fetching unspent outputs`);
    }

    const input = new TransactionInput(
      TransactionId(Buffer.from(item.txoRef.hash).toString("hex")),
      BigInt(item.txoRef.index),
    );

    const output = this._rpcTxOutToCoreTxOut(item.parsedValued! as spec.cardano.TxOutput);

    return new TransactionUnspentOutput(input, output);
  }

  async resolveUnspentOutputs(
    txIns: TransactionInput[],
  ): Promise<TransactionUnspentOutput[]> {
    const references = txIns.map((txIn) => {
      const txHashBytes = new Uint8Array(
        Buffer.from(txIn.transactionId().toString(), "hex"),
      );
      return {
        txHash: txHashBytes,
        outputIndex: Number(txIn.index().toString()),
      };
    });
    const utxoSearchResult =
      await this.queryClient.readUtxosByOutputRef(references);
    return (
      utxoSearchResult?.map((item) => {
        const input = new TransactionInput(
          TransactionId(Buffer.from(item.txoRef.hash).toString("hex")),
          BigInt(item.txoRef.index),
        );

        const output = this._rpcTxOutToCoreTxOut(item.parsedValued! as spec.cardano.TxOutput);

        return new TransactionUnspentOutput(input, output);
      }) ?? []
    );
  }

  resolveDatum(datumHash: DatumHash): Promise<PlutusData> {
    console.log("resolveDatum", datumHash);
    throw new Error("Method not implemented.");
  }

  awaitTransactionConfirmation(
    txId: TransactionId,
    timeout?: number,
  ): Promise<boolean> {
    const onConfirmed = (async () => {
      const updates = this.submitClient.waitForTx(fromHex(txId.toString()));

      for await (const stage of updates) {
        if (stage == submit.Stage.CONFIRMED) {
          return true;
        }
      }

      return false;
    })();

    const onTimeout: Promise<boolean> = new Promise((resolve) =>
      setTimeout(() => resolve(false), timeout),
    );

    return Promise.race([onConfirmed, onTimeout]);
  }

  async postTransactionToChain(tx: Transaction): Promise<TransactionId> {
    const cbor = fromHex(tx.toCbor());
    const hash = await this.submitClient.submitTx(cbor);
    return TransactionId(toHex(hash));
  }

  async evaluateTransaction(
    tx: Transaction,
    additionalUtxos: TransactionUnspentOutput[],
  ): Promise<Redeemers> {
    const additonalInputs: TransactionInput[] = [];
    const additionalOutputs: TransactionOutput[] = [];
    additionalUtxos.forEach((utxo) => {
      additonalInputs.push(utxo.input());
      additionalOutputs.push(utxo.output());
    });
    const finalInputs = tx.body().inputs().values().concat(additonalInputs);
    const finalOutputs = tx.body().outputs().concat(additionalOutputs);
    tx.body().inputs().setValues(finalInputs);
    tx.body().setOutputs(finalOutputs);
    const unevaluatedRedeemers = tx.witnessSet().redeemers()?.values() ?? [];

    const report = await this.submitClient.evalTx(fromHex(tx.toCbor()));
    const chainEval = report.report?.chain;
    if (!chainEval || chainEval.case !== "cardano") {
      throw new Error("Unexpected evalTx response: missing Cardano report");
    }
    const evalResult = chainEval.value.redeemers ?? [];

    const redeemers: Redeemer[] = [];
    for(let i = 0; i < evalResult.length; i++) {
      const unevaluated = unevaluatedRedeemers[i];
      if (unevaluated === undefined) {
        throw new Error(
          `evaluateTransaction: evaluation returned more redeemers than the transaction contains`,
        );
      }
      const exUnits = evalResult[i]?.exUnits;
      if (exUnits === undefined) {
        throw new Error(
          `evaluateTransaction: missing execution units for redeemer at index ${i}`,
        );
      }
      redeemers.push(new Redeemer(
        unevaluated.tag(),
        unevaluated.index(),
        unevaluated.data(),
        new ExUnits(BigInt(exUnits.memory), BigInt(exUnits.steps))
      ));
    }

    const finalRedeemers = Redeemers.fromCore([]);
    finalRedeemers.setValues(redeemers);
    return finalRedeemers;
  }

  private _rpcTxOutToCoreTxOut(
    rpcTxOutput: spec.cardano.TxOutput,
  ): TransactionOutput {
    const output = new TransactionOutput(
      Address.fromBytes(HexBlob.fromBytes(rpcTxOutput.address)),
      this._rpcTxOutToCoreValue(rpcTxOutput),
    );

    if (rpcTxOutput.datum !== undefined) {
      if (
        rpcTxOutput.datum?.originalCbor &&
        rpcTxOutput.datum.originalCbor.length > 0
      ) {
        const inlineDatum = Datum.newInlineData(
          PlutusData.fromCbor(
            HexBlob.fromBytes(rpcTxOutput.datum.originalCbor),
          ),
        );
        output.setDatum(inlineDatum);
      } else if (rpcTxOutput.datum?.hash && rpcTxOutput.datum.hash.length > 0) {
        const datumHash = Datum.newDataHash(
          DatumHash(Buffer.from(rpcTxOutput.datum.hash).toString("hex")),
        );
        output.setDatum(datumHash);
      }
    }

    if (rpcTxOutput.script !== undefined) {
      if (rpcTxOutput.script.script.case === "plutusV1") {
        const cbor = rpcTxOutput.script.script.value;
        output.setScriptRef(
          cborToScript(Buffer.from(cbor).toString('hex'), "PlutusV1"),
        );
      }

      if (rpcTxOutput.script.script.case === "plutusV2") {
        const cbor = rpcTxOutput.script.script.value;
        output.setScriptRef(
          cborToScript(Buffer.from(cbor).toString('hex'), "PlutusV2"),
        );
      }

      if (rpcTxOutput.script.script.case == "plutusV3") {
        const cbor = rpcTxOutput.script.script.value;
        output.setScriptRef(
          cborToScript(Buffer.from(cbor).toString('hex'), "PlutusV3"),
        );
      }
    }

    return output;
  }

  private _rpcTxOutToCoreValue(rpcTxOutput: spec.cardano.TxOutput): Value {
    return new Value(
      this._rpcBigIntToNative(rpcTxOutput.coin),
      this._rpcMultiAssetOutputToTokenMap(rpcTxOutput.assets),
    );
  }

  private _rpcMultiAssetOutputToTokenMap(
    multiAsset: spec.cardano.Multiasset[],
  ): TokenMap {
    const tokenMap: TokenMap = new Map();
    multiAsset.forEach((ma) => {
      ma.assets.forEach((asset) => {
        const assetId = AssetId.fromParts(
          PolicyId(Buffer.from(ma.policyId).toString("hex")),
          AssetName(Buffer.from(asset.name).toString("hex")),
        );

        const quantity =
          asset.quantity.case === "outputCoin"
            ? this._rpcBigIntToNative(asset.quantity.value)
            : asset.quantity.case === "mintCoin"
            ? this._rpcBigIntToNative(asset.quantity.value)
            : 0n;

        if (tokenMap.has(assetId)) {
          tokenMap.set(assetId, tokenMap.get(assetId)! + quantity);
        } else {
          tokenMap.set(assetId, quantity);
        }
      });
    });
    return tokenMap;
  }

  private _rpcPParamsToCorePParams(
    rpcPParams: spec.cardano.PParams,
  ): ProtocolParameters {
    return {
      coinsPerUtxoByte: Number(this._rpcBigIntToNative(rpcPParams.coinsPerUtxoByte)),
      costModels: (new Map() as CostModels)
        .set(
          PlutusLanguageVersion.V1,
          rpcPParams.costModels?.plutusV1?.values.map((v) =>
            Number(v.toString()),
          ) ??
          hardCodedProtocolParams.costModels.get(PlutusLanguageVersion.V1) ??
          [],
        )
        .set(
          PlutusLanguageVersion.V2,
          rpcPParams.costModels?.plutusV2?.values.map((v) =>
            Number(v.toString()),
          ) ??
          hardCodedProtocolParams.costModels.get(PlutusLanguageVersion.V2) ??
          [],
        )
        .set(
          PlutusLanguageVersion.V3,
          rpcPParams.costModels?.plutusV3?.values.map((v) =>
            Number(v.toString()),
          ) ??
            hardCodedProtocolParams.costModels.get(PlutusLanguageVersion.V3) ??
            [],
        ),
      maxBlockBodySize: Number(rpcPParams.maxBlockBodySize),
      maxBlockHeaderSize: Number(rpcPParams.maxBlockHeaderSize),
      maxCollateralInputs: Number(rpcPParams.maxCollateralInputs),
      maxExecutionUnitsPerBlock: {
        steps: Number(rpcPParams.maxExecutionUnitsPerBlock?.steps),
        memory: Number(rpcPParams.maxExecutionUnitsPerBlock?.memory),
      },
      maxTxSize: Number(rpcPParams.maxTxSize),
      minFeeConstant: Number(this._rpcBigIntToNative(rpcPParams.minFeeConstant)),
      minFeeCoefficient: Number(this._rpcBigIntToNative(rpcPParams.minFeeCoefficient)),
      minPoolCost: Number(this._rpcBigIntToNative(rpcPParams.minPoolCost)),
      poolDeposit: Number(this._rpcBigIntToNative(rpcPParams.poolDeposit)),
      stakeKeyDeposit: Number(this._rpcBigIntToNative(rpcPParams.stakeKeyDeposit)),
      poolRetirementEpochBound: Number(rpcPParams.poolRetirementEpochBound),
      desiredNumberOfPools: Number(rpcPParams.desiredNumberOfPools),
      poolInfluence: `${this._rpcRatioToNumber(rpcPParams.poolInfluence)}`,
      monetaryExpansion: `${this._rpcRatioToNumber(rpcPParams.monetaryExpansion)}`,
      treasuryExpansion: `${this._rpcRatioToNumber(rpcPParams.treasuryExpansion)}`,
      protocolVersion: {
        minor: Number(rpcPParams.protocolVersion?.minor),
        major: Number(rpcPParams.protocolVersion?.major),
      },
      maxValueSize: Number(rpcPParams.maxValueSize),
      collateralPercentage: Number(rpcPParams.collateralPercentage),
      prices: {
        memory: Number(this._rpcRatioToNumber(rpcPParams.prices?.memory)),
        steps: Number(this._rpcRatioToNumber(rpcPParams.prices?.steps)),
      },
      maxExecutionUnitsPerTransaction: {
        memory: Number(rpcPParams.maxExecutionUnitsPerTransaction?.memory),
        steps: Number(rpcPParams.maxExecutionUnitsPerTransaction?.steps),
      },
      minFeeReferenceScripts: {
        base: Number(this._rpcRatioToNumber(rpcPParams.minFeeScriptRefCostPerByte)),
        range: 25600,
        multiplier: 1.2,
      }
    };
  }

  getSlotConfig() {
    switch (this.networkName) {
      case "cardano-mainnet":
        return SLOT_CONFIG_NETWORK.Mainnet;
      case "cardano-preprod":
        return SLOT_CONFIG_NETWORK.Preprod;
      case "cardano-preview":
        return SLOT_CONFIG_NETWORK.Preview;
      default:
        // Default to preprod for testnet
        return SLOT_CONFIG_NETWORK.Preprod;
    }
  }

  unixToSlot(unix_millis: number | bigint) {
    const slotConfig = this.getSlotConfig();
    const unixMs = Number(unix_millis);
    return Slot(Math.floor((unixMs - slotConfig.zeroTime) / slotConfig.slotLength + slotConfig.zeroSlot));
  }

  slotToUnix(slot: Slot): number {
    const slotConfig = this.getSlotConfig();
    return slotConfig.zeroTime + (Number(slot.valueOf()) - slotConfig.zeroSlot) * slotConfig.slotLength;
  }
}
