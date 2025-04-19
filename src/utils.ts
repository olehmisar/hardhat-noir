import { HardhatPluginError } from "hardhat/plugins";
import type { SpawnOptions } from "node:child_process";

export const PLUGIN_NAME = "hardhat-noir";

export const makeRunCommand =
  (cwd?: string) =>
  async (
    command: string,
    args: (string | number)[],
    options?: Pick<SpawnOptions, "env">,
  ) => {
    const { spawn } = await import("node:child_process");

    const spawned = spawn(
      command,
      args.map((arg) => arg.toString()),
      { ...options, cwd },
    );
    spawned.stdout.on("data", (data) => {
      process.stdout.write(data);
    });

    spawned.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    return await new Promise<void>((resolve, reject) => {
      spawned.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}`));
          return;
        }

        resolve();
      });

      spawned.on("error", (err) => {
        reject(
          new HardhatPluginError(
            PLUGIN_NAME,
            `Error executing command \`${
              command + " " + args.join(" ")
            }\`: ${err.message}`,
          ),
        );
      });
    });
  };
