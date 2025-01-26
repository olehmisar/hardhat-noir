import { HardhatPluginError } from "hardhat/plugins";

export const PLUGIN_NAME = "hardhat-plugin-noir";

export const makeRunCommand = (cwd?: string) => async (command: string) => {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  // TODO(security): escape command arguments (use template strings)
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      maxBuffer: Infinity,
    });
    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error((error as any).stderr || (error as any).message); // Log only error messages
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Error executing command: ${command}`,
    );
  }
};
