import { extendConfig, extendEnvironment } from "hardhat/config";
import { HardhatPluginError, lazyObject } from "hardhat/plugins";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types";
import path from "path";
import { NoirExtension } from "./Noir";
import "./tasks";
import "./type-extensions";
import { PLUGIN_NAME } from "./utils";

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    // We apply our default config here. Any other kind of config resolution
    // or normalization should be placed here.
    //
    // `config` is the resolved config, which will be used during runtime and
    // you should modify.
    // `userConfig` is the config as provided by the user. You should not modify
    // it.
    //
    // If you extended the `HardhatConfig` type, you need to make sure that
    // executing this function ensures that the `config` object is in a valid
    // state for its type, including its extensions. For example, you may
    // need to apply a default value, like in this example.
    const userNoirPath = userConfig.paths?.noir;

    let noirPath: string;
    if (userNoirPath === undefined) {
      noirPath = path.join(config.paths.root, "noir");
    } else {
      if (path.isAbsolute(userNoirPath)) {
        noirPath = userNoirPath;
      } else {
        // We resolve relative paths starting from the project's root.
        // Please keep this convention to avoid confusion.
        noirPath = path.normalize(path.join(config.paths.root, userNoirPath));
      }
    }

    config.paths.noir = noirPath;
    config.noir = resolveNoirConfig(userConfig.noir);

    function resolveNoirConfig(
      u: HardhatUserConfig["noir"],
    ): HardhatConfig["noir"] {
      const bbVersionMap: Record<string, string> = {
        "0.37.0": "0.61.0",
        "0.38.0": "0.61.0",
        "0.39.0": "0.63.1",
        "1.0.0-beta.0": "0.63.1",
      };
      u = u || {};
      const version = u.version;
      const bbVersion = bbVersionMap[version];
      if (!bbVersion) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          `cannot infer bb version for noir@${version}. Please specify \`noir.bbVersion\` in Hardhat config`,
        );
      }
      return {
        version,
        bbVersion,
        skipNargoWorkspaceCheck: u.skipNargoWorkspaceCheck ?? false,
      };
    }
  },
);

extendEnvironment((hre) => {
  // We add a field to the Hardhat Runtime Environment here.
  // We use lazyObject to avoid initializing things until they are actually
  // needed.
  hre.noir = lazyObject(() => new NoirExtension(hre));
});
