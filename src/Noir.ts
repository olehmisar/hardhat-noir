import type { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit, Noir } from "@noir-lang/noir_js";
import { HardhatPluginError } from "hardhat/plugins";
import type { HardhatConfig, HardhatRuntimeEnvironment } from "hardhat/types";
import { PLUGIN_NAME } from "./utils";

export class NoirExtension {
  constructor(private hre: HardhatRuntimeEnvironment) {}

  /**
   * Get the JSON of the given circuit by name.
   */
  async getCircuitJson(name: string): Promise<CompiledCircuit> {
    const target = await getTarget(this.hre.config.paths.noir);
    const fs = await import("fs");
    const path = await import("path");
    const { readFile } = await import("fs/promises");
    const filename = path.join(target, `${name}.json`);
    if (!fs.existsSync(filename)) {
      throw new HardhatPluginError(PLUGIN_NAME, `${filename} does not exist`);
    }
    try {
      return JSON.parse(await readFile(filename, "utf-8"));
    } catch (error) {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        `${filename} is not a valid JSON`,
      );
    }
  }

  /**
   * Creates a Noir and Backend instances for the given circuit.
   * Call this only once per circuit as it creates a new backend each time.
   *
   * @param name name of the circuit
   * @param backendClass Backend class. Currently, only {@link UltraHonkBackend}-like backends are supported.
   */
  async getCircuit<T = UltraHonkBackend>(
    name: string,
    backendClass?: new (bytecode: string) => T,
  ): Promise<{
    circuit: CompiledCircuit;
    noir: Noir;
    backend: T;
  }> {
    backendClass ||= await (async () => {
      const { UltraHonkBackend } = await import("@aztec/bb.js");
      return UltraHonkBackend as unknown as NonNullable<typeof backendClass>;
    })();
    const circuit = await this.getCircuitJson(name);
    const { Noir } = await import("@noir-lang/noir_js");
    const noir = new Noir(circuit);
    const backend = new backendClass(circuit.bytecode);
    return { circuit, noir, backend };
  }
}

export async function getTarget(noirDir: string | HardhatConfig) {
  noirDir = typeof noirDir === "string" ? noirDir : noirDir.paths.noir;
  const path = await import("path");
  return path.join(noirDir, "target");
}

export type ProofFlavor = keyof typeof ProofFlavor;
export const ProofFlavor = {
  ultra_keccak_honk: "ultra_keccak_honk",
} as const;
