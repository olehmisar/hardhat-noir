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
      "curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash",
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

async function installBbup() {
  const path = await import("path");
  const fs = await import("fs");
  const bbupBinary = path.join(await getBbHome(), "bbup");
  if (!fs.existsSync(bbupBinary)) {
    const runCommand = makeRunCommand();
    console.log("Installing bbup");
    await runCommand(
      `curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash`,
    );
  }
  return bbupBinary;
}

export async function installBb(bbVersion: string): Promise<string> {
  const bbupBinary = await installBbup();

  const fs = await import("fs");
  const path = await import("path");
  const bbHome = await getBbHome();
  const bbBinary = path.join(
    bbHome,
    installationSeparator,
    `v${bbVersion}`,
    "bb",
  );
  if (!fs.existsSync(bbBinary)) {
    const runCommand = makeRunCommand();
    const bbDir = path.dirname(bbBinary);
    fs.mkdirSync(bbDir, { recursive: true });
    console.log(`Installing bb@${bbVersion} in ${bbDir}`);
    await runCommand(`BB_HOME=${bbDir} ${bbupBinary} -v ${bbVersion}`);
  }
  return bbBinary;
}

async function getBbHome() {
  const os = await import("os");
  const path = await import("path");
  return path.join(os.homedir(), ".bb");
}
