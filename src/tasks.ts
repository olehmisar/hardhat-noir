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
import { getTarget, ProofFlavor } from "./Noir";
import { makeRunCommand, PLUGIN_NAME } from "./utils";

task(TASK_COMPILE, "Compile and generate circuits and contracts").setAction(
  async (args, { config }, runSuper) => {
    const noirDir = config.paths.noir;
    const targetDir = await getTarget(noirDir);

    const runCommand = makeRunCommand(config.paths.noir);

    const nargoBinary = await installNargo(config.noir.version);

    await checkNargoWorkspace(config);
    await addGitIgnore(noirDir);

    const force = !!args.force;
    const cache = await NoirCache.fromConfig(config);
    if ((await cache.haveSourceFilesChanged()) || force) {
      console.log("Compiling Noir circuits...");
      await runCommand(nargoBinary, ["compile"]);
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

        for (const flavor of Object.values(ProofFlavor) as ProofFlavor[]) {
          if (!config.noir.flavor.includes(flavor)) {
            continue;
          }
          await generateSolidityVerifier(file, targetDir, flavor);
        }
        await cache.saveJsonFileHash(file);
      }),
    );

    await runSuper(); // Run the default Hardhat compile
  },
);

task(TASK_CLEAN).setAction(async (_, { config }, runSuper) => {
  const fs = await import("fs");

  await runSuper();

  const targetDir = await getTarget(config.paths.noir);
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

async function generateSolidityVerifier(
  file: string,
  targetDir: string,
  flavor: ProofFlavor,
) {
  const path = await import("path");
  const fs = await import("fs");
  const { UltraHonkBackend, UltraPlonkBackend } = await import("@aztec/bb.js");

  let verifier: string;
  const program = JSON.parse(fs.readFileSync(file, "utf-8"));
  switch (flavor) {
    case "ultra_plonk": {
      const backend = new UltraPlonkBackend(program.bytecode);
      verifier = await backend.getSolidityVerifier();
      break;
    }
    case "ultra_keccak_honk": {
      const backend = new UltraHonkBackend(program.bytecode);
      const vk = await backend.getVerificationKey({ keccak: true });
      verifier = await backend.getSolidityVerifier(vk);
      break;
    }
    default: {
      flavor satisfies never;
      throw new HardhatPluginError(
        PLUGIN_NAME,
        `Unsupported Noir proof flavor: ${flavor}`,
      );
    }
  }
  if (typeof verifier !== "string") {
    // bug in bb types
    verifier = new TextDecoder().decode(verifier);
  }

  const name = path.basename(file, ".json");
  console.log(`Generating Solidity ${flavor} verifier for ${name}...`);
  const nameSuffix =
    flavor === ProofFlavor.ultra_keccak_honk ? "" : `_${flavor}`;
  fs.writeFileSync(path.join(targetDir, `${name}${nameSuffix}.sol`), verifier);
  console.log(`Generated Solidity ${flavor} verifier for ${name}`);
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
