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
  RedeemerTag,
  ExUnits,
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
  PlutusV1Script,
  Script,
  PlutusV2Script,
  fromHex,
  toHex,
  PlutusLanguageVersion,
  hardCodedProtocolParams,
  PlutusV3Script,
} from "@blaze-cardano/core";
import { Provider } from "@blaze-cardano/query";
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
    super(network);
    this.queryClient = new CardanoQueryClient({
      uri: url,
      headers,
    });

    this.submitClient = new CardanoSubmitClient({
      uri: url,
      headers,
    });
  }

  async resolveScriptRef(script: Script | Hash28ByteBase16, address?: Address): Promise<TransactionUnspentOutput | undefined> {
    return super.resolveScriptRef(script, address);
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
    let additonalInputs: TransactionInput[] = [];
    let additionalOutputs: TransactionOutput[] = [];
    additionalUtxos.forEach((utxo) => {
      additonalInputs.push(utxo.input());
      additionalOutputs.push(utxo.output());
    });
    const finalInputs = tx.body().inputs().values().concat(additonalInputs);
    const finalOutputs = tx.body().outputs().concat(additionalOutputs);
    tx.body().inputs().setValues(finalInputs);
    tx.body().setOutputs(finalOutputs);
    const unevaluatedRedeemers = tx.witnessSet().redeemers()?.values()!;
    
    const report = await this.submitClient.evalTx(fromHex(tx.toCbor()));
    const evalResult = report.report[0].chain.value?.redeemers!;

    let redeemers: Redeemer[] = [];
    for(let i = 0; i < evalResult.length; i++) {
      redeemers.push(new Redeemer(
        unevaluatedRedeemers[i].tag()  ,
        unevaluatedRedeemers[i].index(),
        unevaluatedRedeemers[i].data(),
        new ExUnits(
          BigInt(evalResult[i].exUnits?.memory!),
          BigInt(evalResult[i].exUnits?.steps!)
        )
      ))
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
      BigInt(rpcTxOutput.coin),
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

        const quantity = BigInt(asset.outputCoin);

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
      coinsPerUtxoByte: Number(rpcPParams.coinsPerUtxoByte),
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
          [100788, 420, 1, 1, 1000, 173, 0, 1, 1000, 59957, 4, 1, 11183, 32, 201305, 8356, 4,
            16000, 100, 16000, 100, 16000, 100, 16000, 100, 16000, 100, 16000, 100, 100, 100,
            16000, 100, 94375, 32, 132994, 32, 61462, 4, 72010, 178, 0, 1, 22151, 32, 91189,
            769, 4, 2, 85848, 123203, 7305, -900, 1716, 549, 57, 85848, 0, 1, 1, 1000, 42921,
            4, 2, 24548, 29498, 38, 1, 898148, 27279, 1, 51775, 558, 1, 39184, 1000, 60594, 1,
            141895, 32, 83150, 32, 15299, 32, 76049, 1, 13169, 4, 22100, 10, 28999, 74, 1,
            28999, 74, 1, 43285, 552, 1, 44749, 541, 1, 33852, 32, 68246, 32, 72362, 32, 7243,
            32, 7391, 32, 11546, 32, 85848, 123203, 7305, -900, 1716, 549, 57, 85848, 0, 1,
            90434, 519, 0, 1, 74433, 32, 85848, 123203, 7305, -900, 1716, 549, 57, 85848, 0, 1,
            1, 85848, 123203, 7305, -900, 1716, 549, 57, 85848, 0, 1, 955506, 213312, 0, 2,
            270652, 22588, 4, 1457325, 64566, 4, 20467, 1, 4, 0, 141992, 32, 100788, 420, 1, 1,
            81663, 32, 59498, 32, 20142, 32, 24588, 32, 20744, 32, 25933, 32, 24623, 32,
            43053543, 10, 53384111, 14333, 10, 43574283, 26308, 10, 16000, 100, 16000, 100,
            962335, 18, 2780678, 6, 442008, 1, 52538055, 3756, 18, 267929, 18, 76433006, 8868,
            18, 52948122, 18, 1995836, 36, 3227919, 12, 901022, 1, 166917843, 4307, 36, 284546,
            36, 158221314, 26549, 36, 74698472, 36, 333849714, 1, 254006273, 72, 2174038, 72,
            2261318, 64571, 4, 207616, 8310, 4, 1293828, 28716, 63, 0, 1, 1006041, 43623, 251,
            0, 1, 100181, 726, 719, 0, 1, 100181, 726, 719, 0, 1, 100181, 726, 719, 0, 1,
            107878, 680, 0, 1, 95336, 1, 281145, 18848, 0, 1, 180194, 159, 1, 1, 158519, 8942,
            0, 1, 159378, 8813, 0, 1, 107490, 3298, 1, 106057, 655, 1, 1964219, 24520, 3]
          ,
        ),
      maxBlockBodySize: Number(rpcPParams.maxBlockBodySize),
      maxBlockHeaderSize: Number(rpcPParams.maxBlockHeaderSize),
      maxCollateralInputs: Number(rpcPParams.maxCollateralInputs),
      maxExecutionUnitsPerBlock: {
        steps: Number(rpcPParams.maxExecutionUnitsPerBlock?.steps),
        memory: Number(rpcPParams.maxExecutionUnitsPerBlock?.memory),
      },
      maxTxSize: Number(rpcPParams.maxTxSize),
      minFeeConstant: Number(rpcPParams.minFeeConstant),
      minFeeCoefficient: Number(rpcPParams.minFeeCoefficient),
      minPoolCost: Number(rpcPParams.minPoolCost),
      poolDeposit: Number(rpcPParams.poolDeposit),
      stakeKeyDeposit: Number(rpcPParams.stakeKeyDeposit),
      poolRetirementEpochBound: Number(rpcPParams.poolRetirementEpochBound),
      desiredNumberOfPools: Number(rpcPParams.desiredNumberOfPools),
      poolInfluence: `${rpcPParams.poolInfluence?.numerator}/${rpcPParams.poolInfluence?.denominator}`,
      monetaryExpansion: `${rpcPParams.monetaryExpansion?.numerator}/${rpcPParams.monetaryExpansion?.denominator}`,
      treasuryExpansion: `${rpcPParams.treasuryExpansion?.numerator}/${rpcPParams.treasuryExpansion?.denominator}`,
      protocolVersion: {
        minor: Number(rpcPParams.protocolVersion?.minor),
        major: Number(rpcPParams.protocolVersion?.major),
      },
      maxValueSize: Number(rpcPParams.maxValueSize),
      collateralPercentage: Number(rpcPParams.collateralPercentage),
      prices: {
        memory: Number(rpcPParams.prices?.memory?.numerator! / rpcPParams.prices?.memory?.denominator!),
        steps: Number(rpcPParams.prices?.steps?.numerator! / rpcPParams.prices?.steps?.denominator!),
      },
      maxExecutionUnitsPerTransaction: {
        memory: Number(rpcPParams.maxExecutionUnitsPerTransaction?.memory),
        steps: Number(rpcPParams.maxExecutionUnitsPerTransaction?.steps),
      },
      minFeeReferenceScripts: {
        base: Number(rpcPParams.minFeeScriptRefCostPerByte?.numerator! / rpcPParams.minFeeScriptRefCostPerByte?.denominator!),
        range: 25600,
        multiplier: 1.2,
      }
    };
  }
}
