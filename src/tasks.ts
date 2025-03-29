import type { UltraHonkBackend, UltraPlonkBackend } from "@aztec/bb.js";
import {
  TASK_CLEAN,
  TASK_COMPILE,
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
} from "hardhat/builtin-tasks/task-names";
import { task } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { HardhatConfig } from "hardhat/types";
import { NoirCache } from "./cache";
import { getTarget, ProofFlavor } from "./Noir";
import { PLUGIN_NAME } from "./utils";

task(TASK_COMPILE, "Compile and generate circuits and contracts").setAction(
  async (args, { config }, runSuper) => {
    const fs = await import("fs");
    const path = await import("path");

    const noirDir = config.paths.noir;
    const targetDir = await getTarget(noirDir);

    await checkNargoWorkspace(config);
    await addGitIgnore(noirDir);

    const force = !!args.force;
    const cache = await NoirCache.fromConfig(config);
    if ((await cache.haveSourceFilesChanged()) || force) {
      console.log("Compiling Noir circuits...");
      const { compile, createFileManager } = await import(
        "@noir-lang/noir_wasm"
      );
      const toml = await import("smol-toml");

      // list dirs
      const dirs = (
        (
          toml.parse(
            fs.readFileSync(path.join(noirDir, "Nargo.toml"), "utf-8"),
          ) as any
        ).workspace.members as string[]
      ).map((dir: string) => path.join(noirDir, dir));

      await Promise.all(
        dirs.map(async (dir) => {
          const fileManager = createFileManager(dir);
          const compiled = await compile(fileManager);
          const name: unknown = (
            toml.parse(
              fs.readFileSync(path.join(dir, "Nargo.toml"), "utf-8"),
            ) as any
          ).package?.name;
          if (typeof name !== "string") {
            throw new HardhatPluginError(
              PLUGIN_NAME,
              `Nargo.toml must contain a name, but ${dir}/Nargo.toml does not`,
            );
          }
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(
            path.join(targetDir, `${name}.json`),
            JSON.stringify(compiled.program, null, 2),
          );
        }),
      );

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
  .addOptionalParam("lib", "If set, create a library package")
  .addOptionalParam(
    "noAdd",
    "If set, do not add the package to the Nargo.toml workspace",
  )
  .setAction(async (args, { config }) => {
    const fs = await import("fs");
    const path = await import("path");
    const toml = await import("smol-toml");
    const { generateNargoToml, generateMain, generateLib } = await import(
      "./templates"
    );

    if (args.name.includes("-")) {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        "Package name cannot contain '-'",
      );
    }

    const newPath = path.join(config.paths.noir, args.name);
    const srcPath = path.join(newPath, "src");
    fs.mkdirSync(srcPath, { recursive: true });

    fs.writeFileSync(
      path.join(newPath, "Nargo.toml"),
      generateNargoToml(args.name),
    );
    if (args.lib) {
      fs.writeFileSync(path.join(srcPath, "lib.nr"), generateLib());
    } else {
      fs.writeFileSync(path.join(srcPath, "main.nr"), generateMain());
    }

    if (!args.noAdd) {
      const rootNargoPath = path.join(config.paths.noir, "Nargo.toml");
      const rootNargo = toml.parse(fs.readFileSync(rootNargoPath, "utf-8")) as {
        workspace?: { members?: string[] };
      };
      rootNargo.workspace ??= {};
      rootNargo.workspace.members ??= [];
      rootNargo.workspace.members.push(args.name);
      fs.writeFileSync(rootNargoPath, toml.stringify(rootNargo));
    }
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

  let backend: UltraHonkBackend | UltraPlonkBackend;
  const program = JSON.parse(fs.readFileSync(file, "utf-8"));
  switch (flavor) {
    case "ultra_plonk": {
      backend = new UltraPlonkBackend(program.bytecode);
      break;
    }
    case "ultra_keccak_honk": {
      backend = new UltraHonkBackend(program.bytecode);
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
  let verifier = await backend.getSolidityVerifier();
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
