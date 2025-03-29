import { makeRunCommand } from "./utils";

const installationSeparator = "hardhat";

async function installNoirup() {
  const path = await import("path");
  const fs = await import("fs");
  const noirupBinary = path.join(await getNargoHome(), "bin", "noirup");
  if (!fs.existsSync(noirupBinary)) {
    const runCommand = makeRunCommand();
    console.log("Installing noirup");
    await runCommand(
      "curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash",
    );
  }
  return noirupBinary;
}

export async function installNargo(version: string) {
  const noirupBinary = await installNoirup();

  const path = await import("path");
  const fs = await import("fs");
  const nargoBinary = path.join(
    await getNargoHome(),
    installationSeparator,
    `v${version}`,
    "bin",
    "nargo",
  );
  if (!fs.existsSync(nargoBinary)) {
    const runCommand = makeRunCommand();
    const nargoBinDir = path.dirname(nargoBinary);
    fs.mkdirSync(path.join(nargoBinDir), { recursive: true });
    console.log(`Installing nargo@${version} in ${nargoBinDir}`);
    await runCommand(
      `NARGO_HOME=${path.dirname(nargoBinDir)} ${noirupBinary} -v ${version}`,
    );
  }
  return nargoBinary;
}

async function getNargoHome() {
  const os = await import("os");
  const path = await import("path");
  return path.join(os.homedir(), ".nargo");
}
