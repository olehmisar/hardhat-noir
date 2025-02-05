// We load the plugin here.
import "@nomicfoundation/hardhat-ethers";
import { HardhatUserConfig } from "hardhat/types";

import "../../../src/index";
import { TEST_NOIR_VERSION } from "../noir-version";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000000,
      },
    },
  },
  defaultNetwork: "hardhat",
  paths: {
    noir: "noir2",
  },
  noir: {
    version: TEST_NOIR_VERSION,
  },
};

export default config;
