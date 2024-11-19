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
