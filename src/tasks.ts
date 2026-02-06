import {
  TASK_CLEAN,
  TASK_COMPILE,
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
} from "hardhat/builtin-tasks/task-names";
import { task } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { HardhatConfig } from "hardhat/types";
import { NoirCache } from "./cache";
import { installNargo } from "./install";
import { getTarget } from "./Noir";
import { makeRunCommand, PLUGIN_NAME } from "./utils";

task(TASK_COMPILE, "Compile and generate circuits and contracts").setAction(
  async (args, { config }, runSuper) => {
    const noirDir = config.paths.noir;
    const targetDir = await getTarget(noirDir);

    const runCommand = makeRunCommand(config.paths.noir);

    await checkNargoWorkspace(config);
    await addGitIgnore(noirDir);

    const force = !!args.force;
    const cache = await NoirCache.fromConfig(config);
    if ((await cache.haveSourceFilesChanged()) || force) {
      console.log("Compiling Noir circuits...");
      
      // Try native compilation first, fallback to WASM
      const compiled = await compileWithFallback(
        config,
        runCommand,
        targetDir,
      );
      
      if (!compiled) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          "Failed to compile Noir circuits with both native and WASM compilation",
        );
      }
      
      await cache.saveSourceFilesHash();
      console.log("Compiled Noir circuits");
    }

    const glob = await import("glob");
    const jsonFiles = glob.sync(`${targetDir}/*.json`);
    await Promise.all(
      jsonFiles.map(async (file) => {
        if (!(await cache.hasJsonFileChanged(file)) && !force) {
          return;
        }

        await generateSolidityVerifier(file, targetDir);
        await cache.saveJsonFileHash(file);
      }),
    );

    await runSuper(); // Run the default Hardhat compile
  },
);

task(TASK_CLEAN).setAction(async (_, { config }, runSuper) => {
  const fs = await import("fs");

  await runSuper();

  const targetDir = await getTarget(config);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true });
  }
});

task("noir-new", "Create a new Noir package")
  .addPositionalParam("name", "The name of the package")
  .addOptionalParam("lib", "If true, create a library package")
  .setAction(async (args, { config }) => {
    if (args.name.includes("-")) {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        "Package name cannot contain '-'",
      );
    }

    const fs = await import("fs");

    const nargoBinary = await installNargo(config.noir.version);
    const runCommand = makeRunCommand(config.paths.noir);
    fs.mkdirSync(config.paths.noir, { recursive: true });
    const cmdArgs = ["new", args.name];
    if (args.lib) {
      cmdArgs.push("--lib");
    }
    await runCommand(nargoBinary, cmdArgs);
  });

task(
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
  async (_, { config }, runSuper) => {
    const path = await import("path");
    const { glob } = await import("glob");

    const target = await getTarget(config);
    const noirPaths = await glob(path.join(target, "*.sol"));

    const paths = await runSuper();
    return [...paths, ...noirPaths];
  },
);

/**
 * Compile Noir circuits with fallback to WASM if native compilation fails
 * @returns true if compilation succeeded, false otherwise
 */
async function compileWithFallback(
  config: HardhatConfig,
  runCommand: (cmd: string, args: string[]) => Promise<void>,
  targetDir: string,
): Promise<boolean> {
  // Try native compilation first
  try {
    const nargoBinary = await installNargo(config.noir.version);
    await runCommand(nargoBinary, ["compile"]);
    console.log("✓ Native compilation successful");
    return true;
  } catch (nativeError) {
    console.log("✗ Native compilation failed, trying WASM fallback...");
    console.log(`  Error: ${nativeError instanceof Error ? nativeError.message : String(nativeError)}`);
    
    // Fallback to WASM compilation
    try {
      await compileWithWasm(config, targetDir);
      console.log("✓ WASM compilation successful");
      return true;
    } catch (wasmError) {
      console.log("✗ WASM compilation also failed");
      console.log(`  Error: ${wasmError instanceof Error ? wasmError.message : String(wasmError)}`);
      return false;
    }
  }
}

/**
 * Compile Noir circuits using WASM compiler
 * This serves as a fallback when native nargo is not available
 */
async function compileWithWasm(
  config: HardhatConfig,
  targetDir: string,
): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  
  // Ensure target directory exists
  fs.mkdirSync(targetDir, { recursive: true });
  
  // Dynamically import noir_wasm
  const { compile } = await import("@noir-lang/noir_wasm");
  
  const noirDir = config.paths.noir;
  
  // Check if it's a workspace or single crate
  const isWorkspace = fs.existsSync(path.join(noirDir, "Nargo.toml")) && 
    !fs.existsSync(path.join(noirDir, "src"));
  
  if (isWorkspace) {
    // Compile all crates in workspace
    const members = fs
      .readdirSync(noirDir)
      .filter((dir) => 
        fs.existsSync(path.join(noirDir, dir, "Nargo.toml")) &&
        fs.statSync(path.join(noirDir, dir)).isDirectory()
      );
    
    for (const member of members) {
      const cratePath = path.join(noirDir, member);
      await compileCrate(cratePath, targetDir, compile);
    }
  } else {
    // Single crate project
    await compileCrate(noirDir, targetDir, compile);
  }
}

/**
 * Compile a single Noir crate using WASM
 */
async function compileCrate(
  cratePath: string,
  targetDir: string,
  compile: (source: string, options?: { contract?: boolean }) => Promise<{ circuit: string }>,
): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  
  // Read Nargo.toml to get crate name
  const nargoTomlPath = path.join(cratePath, "Nargo.toml");
  if (!fs.existsSync(nargoTomlPath)) {
    throw new Error(`Nargo.toml not found in ${cratePath}`);
  }
  
  const nargoToml = fs.readFileSync(nargoTomlPath, "utf-8");
  const nameMatch = nargoToml.match(/name\s*=\s*"([^"]+)"/);
  const crateName = nameMatch ? nameMatch[1] : path.basename(cratePath);
  
  // Read main.nr file
  const mainNrPath = path.join(cratePath, "src", "main.nr");
  if (!fs.existsSync(mainNrPath)) {
    throw new Error(`src/main.nr not found in ${cratePath}`);
  }
  
  const source = fs.readFileSync(mainNrPath, "utf-8");
  
  console.log(`  Compiling ${crateName} with WASM...`);
  
  // Compile using WASM
  const result = await compile(source, { contract: false });
  
  // Write compiled circuit to target
  const outputPath = path.join(targetDir, `${crateName}.json`);
  fs.writeFileSync(outputPath, result.circuit);
  
  console.log(`  ✓ Compiled ${crateName} -> ${outputPath}`);
}

async function generateSolidityVerifier(file: string, targetDir: string) {
  const path = await import("path");
  const fs = await import("fs");
  const { UltraHonkBackend } = await import("@aztec/bb.js");

  const program = JSON.parse(fs.readFileSync(file, "utf-8"));

  const backend = new UltraHonkBackend(program.bytecode);
  const vk = await backend.getVerificationKey({ keccak: true });
  let verifier = await backend.getSolidityVerifier(vk);

  if (typeof verifier !== "string") {
    // bug in bb types
    verifier = new TextDecoder().decode(verifier);
  }

  const name = path.basename(file, ".json");
  console.log(`Generating Solidity verifier for ${name}...`);
  fs.writeFileSync(path.join(targetDir, `${name}.sol`), verifier);
  console.log(`Generated Solidity verifier for ${name}`);
}

async function checkNargoWorkspace(config: HardhatConfig) {
  if (config.noir.skipNargoWorkspaceCheck) {
    return;
  }
  if (await isSingleCrateProject(config)) {
    return;
  }

  // check all folders 1 level deep for Nargo.toml. Make sure the folder is listed in the workspace Nargo.toml
  const disableNote = `You can disable this check by setting \`noir.skipNargoWorkspaceCheck\` to \`true\` in Hardhat config`;

  const fs = await import("fs");
  const path = await import("path");

  const root = config.paths.noir;
  const members = fs
    .readdirSync(root)
    .filter((dir) => fs.existsSync(path.join(root, dir, "Nargo.toml")));

  const wsNargoPath = path.join(config.paths.noir, "Nargo.toml");
  if (!fs.existsSync(wsNargoPath)) {
    // create one
    await fs.promises.writeFile(
      wsNargoPath,
      `
[workspace]
members = [
  ${members.map((m) => `"${m}"`).join(",\n")}
]
      `.trim() + "\n",
    );
    console.info(
      "Created Nargo.toml in the Noir workspace folder.",
      disableNote,
    );
    return;
  }

  const wsNargo = fs.readFileSync(wsNargoPath, "utf-8");
  const missingMembers = members.filter((m) => !wsNargo.includes(`"${m}"`));
  if (missingMembers.length === 0) {
    return;
  }

  throw new HardhatPluginError(
    PLUGIN_NAME,
    `You are missing these Noir folders in the root Nargo.toml:\n` +
      missingMembers.map((m) => `- ${m}`).join("\n") +
      "\n" +
      disableNote,
  );
}

async function isSingleCrateProject(config: HardhatConfig) {
  const fs = await import("fs");
  const path = await import("path");
  const root = config.paths.noir;
  return (
    fs.existsSync(path.join(root, "Nargo.toml")) &&
    fs.existsSync(path.join(root, "src"))
  );
}

async function addGitIgnore(root: string) {
  const fs = await import("fs");
  const path = await import("path");
  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    return;
  }
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(gitignorePath, "target\n");
  console.log(
    `Added .gitignore to ${root}. To disable this behavior, create an empty .gitignore file in ${root}`,
  );
}
