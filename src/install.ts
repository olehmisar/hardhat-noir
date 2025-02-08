import { HardhatPluginError } from "hardhat/plugins";
import { makeRunCommand, PLUGIN_NAME } from "./utils";

const installationSeparator = "hardhat";

async function installNoirup() {
  const path = await import("path");
  const fs = await import("fs");
  const noirupBinary = path.join(await getNargoHome(), "bin", "noirup");
  if (!fs.existsSync(noirupBinary)) {
    const runCommand = makeRunCommand();
    console.log("Installing noirup");
    const installScript = await downloadScript(
      "https://raw.githubusercontent.com/noir-lang/noirup/main/install",
    );
    await runCommand("bash", ["-c", installScript]);
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
    await runCommand(noirupBinary, ["-v", version], {
      env: { NARGO_HOME: path.dirname(nargoBinDir) },
    });
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
    const installScript = await downloadScript(
      "https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install",
    );
    await runCommand("bash", ["-c", installScript]);
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
    await runCommand(bbupBinary, ["-v", bbVersion], {
      env: { BB_HOME: bbDir },
    });
  }
  return bbBinary;
}

async function getBbHome() {
  const os = await import("os");
  const path = await import("path");
  return path.join(os.homedir(), ".bb");
}

async function downloadScript(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new HardhatPluginError(PLUGIN_NAME, `Failed to download ${url}`);
  }
  return await res.text();
}
