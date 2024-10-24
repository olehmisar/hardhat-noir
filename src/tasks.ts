import { TASK_CLEAN, TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import { task } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { HardhatConfig } from "hardhat/types";
import { NoirCache } from "./cache";
import { installBb, installNargo } from "./install";
import { getTarget } from "./Noir";
import { makeRunCommand, PLUGIN_NAME } from "./utils";

task(TASK_COMPILE, "Compile and generate circuits and contracts").setAction(
  async (_, { config }, runSuper) => {
    const path = await import("path");
    const noirDir = config.paths.noir;
    const targetDir = await getTarget(noirDir);

    const runCommand = makeRunCommand(config.paths.noir);

    const nargoBinary = await installNargo(config.noir.version);
    const bbBinary = await installBb(config.noir.bbVersion);

    await checkNargoWorkspace(config);
    await addGitIgnore(noirDir);

    const cache = await NoirCache.fromConfig(config);
    if (await cache.haveSourceFilesChanged()) {
      await runCommand(`${nargoBinary} compile`);
      await cache.saveSourceFilesHash();
    }

    const glob = await import("glob");
    const jsonFiles = glob.sync(`${targetDir}/*.json`);
    await Promise.all(
      jsonFiles.map(async (file) => {
        if (!(await cache.hasJsonFileChanged(file))) {
          return;
        }

        const name = path.basename(file, ".json");
        await runCommand(
          `${bbBinary} write_vk -b ${targetDir}/${name}.json -o ${targetDir}/${name}_vk`,
        );
        await runCommand(
          `${bbBinary} contract -k ${targetDir}/${name}_vk -o ${targetDir}/${name}.sol`,
        );
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
    await runCommand(
      `${nargoBinary} new ${args.name} ${args.lib ? "--lib" : ""}`,
    );
  });

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
  // use .includes(`"${name}"`) to check toml

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
