import {
  CborReader,
  CborReaderState,
  CborWriter,
  HexBlob,
  NativeScript,
  PlutusV1Script,
  PlutusV2Script,
  PlutusV3Script,
  Script,
} from "@blaze-cardano/core";
import { cardano } from "@utxorpc/spec";

export type ScriptType = "Native" | "PlutusV1" | "PlutusV2" | "PlutusV3";

export function cborToScript(cbor: string, type: ScriptType): Script {
  if (type === "Native") {
    return Script.newNativeScript(NativeScript.fromCbor(HexBlob(cbor)));
  } else {
    const cborReader = new CborReader(HexBlob(cbor));
    while (cborReader.peekState() != CborReaderState.ByteString) {
      cborReader.readTag();
    }
    const cborBytes = cborReader.readByteString();
    const cborWriter = new CborWriter();
    cborWriter.writeByteString(cborBytes);
    const cborHex = cborWriter.encodeAsHex();
    if (type === "PlutusV1") {
      return Script.newPlutusV1Script(new PlutusV1Script(cborHex));
    } else if (type === "PlutusV2") {
      return Script.newPlutusV2Script(new PlutusV2Script(cborHex));
    } else if (type === "PlutusV3") {
      return Script.newPlutusV3Script(new PlutusV3Script(cborHex));
    } else {
      throw new Error(`Unsupported script type: ${type}`);
    }
  }
}

export function cardanoBigintToNativeBigInt(value: cardano.BigInt): bigint {
  if (value.bigInt.case == "int") {
    return value.bigInt.value
  }
  if (value.bigInt.case !== "bigUInt" && value.bigInt.case !== "bigNInt") {
    throw new Error(`Unrecognized BigInt variant "${value.bigInt.case}"`);
  }
  let result: bigint = 0n;
  for (const byte of value.bigInt.value) {
    result = (result << 8n) + BigInt(byte);
  }
  if (value.bigInt.case == "bigNInt") {
    return -result - 1n;
  } else {
    return result;
  }
}

export function cardanoBigintToNumber(value: cardano.BigInt) {
  const bigIntValue = cardanoBigintToNativeBigInt(value);
  if (bigIntValue < Number.MIN_SAFE_INTEGER || bigIntValue > Number.MAX_SAFE_INTEGER) {
    throw new Error(`value "${bigIntValue}" out of range for JS number`);
  }
  return Number(bigIntValue);
}
