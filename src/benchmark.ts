import { task } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { PLUGIN_NAME } from "./utils";

task("noir-benchmark", "Benchmark Noir compilation speed (native vs WASM)")
  .setAction(async (_, { config }) => {
    console.log("\n🚀 Benchmarking Noir compilation...\n");
    
    const results = {
      native: null as number | null,
      wasm: null as number | null,
    };
    
    // Benchmark native compilation
    console.log("Testing native compilation...");
    try {
      const { installNargo } = await import("./install");
      const { makeRunCommand } = await import("./utils");
      
      const nargoBinary = await installNargo(config.noir.version);
      const runCommand = makeRunCommand(config.paths.noir);
      
      const startNative = Date.now();
      await runCommand(nargoBinary, ["compile", "--force"]);
      const endNative = Date.now();
      
      results.native = endNative - startNative;
      console.log(`✓ Native compilation: ${results.native}ms`);
    } catch (error) {
      console.log(`✗ Native compilation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Benchmark WASM compilation
    console.log("\nTesting WASM compilation...");
    try {
      const { getTarget } = await import("./Noir");
      const fs = await import("fs");
      const path = await import("path");
      
      const targetDir = await getTarget(config);
      
      // Clear target to force recompilation
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true });
      }
      
      const { compile } = await import("@noir-lang/noir_wasm");
      const noirDir = config.paths.noir;
      
      const startWasm = Date.now();
      
      // Compile main.nr directly
      const mainNrPath = path.join(noirDir, "src", "main.nr");
      if (!fs.existsSync(mainNrPath)) {
        throw new Error("main.nr not found");
      }
      
      const source = fs.readFileSync(mainNrPath, "utf-8");
      await compile(source, { contract: false });
      
      const endWasm = Date.now();
      
      results.wasm = endWasm - startWasm;
      console.log(`✓ WASM compilation: ${results.wasm}ms`);
    } catch (error) {
      console.log(`✗ WASM compilation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Print results
    console.log("\n📊 Benchmark Results:");
    console.log("====================");
    
    if (results.native && results.wasm) {
      console.log(`Native: ${results.native}ms`);
      console.log(`WASM:   ${results.wasm}ms`);
      
      const diff = results.wasm - results.native;
      const percent = ((diff / results.native) * 100).toFixed(1);
      
      if (results.wasm > results.native) {
        console.log(`\nWASM is ${percent}% slower than native`);
      } else {
        console.log(`\nWASM is ${Math.abs(Number(percent))}% faster than native`);
      }
    } else if (results.native) {
      console.log(`Native: ${results.native}ms`);
      console.log("WASM:   Failed");
    } else if (results.wasm) {
      console.log("Native: Failed");
      console.log(`WASM:   ${results.wasm}ms`);
    } else {
      console.log("Both compilations failed");
    }
    
    console.log("\n✅ Benchmark complete!");
  });
