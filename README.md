<img align="right" width="150" height="150" top="100" src="./assets/banner.jpg">

# Hardhat Noir

Develop [Noir](https://noir-lang.org) with [Hardhat](https://hardhat.org) without hassle.

[Use a boilerplate](https://github.com/olehmisar/hardhat-noir-starter) to get started.

## What

Write programs in Noir, generate Solidity verifiers and run tests.

This plugin automatically manages `nargo` and `bb` versions and compiles Noir on demand.

## Installation

Install the plugin and Noir dependencies:

```bash
npm install hardhat-noir @noir-lang/noir_js@1.0.0-beta.6 @aztec/bb.js@0.87.8
```

Import the plugin in your `hardhat.config.ts`:

```ts
import "hardhat-noir";
```

Specify the Noir version in your Hardhat config:

```ts
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    // enable optimizer to deploy Solidity verifier contracts
    settings: { optimizer: { enabled: true, runs: 100000000 } },
  },
  noir: {
    version: "1.0.0-beta.6",
  },
};
```

## Usage

To get started, create a Noir circuit in `noir` folder:

```bash
npx hardhat noir-new my_noir
```

It will create `noir/my_noir` folder with the following `src/main.nr`:

```rs
fn main(x: Field, y: pub Field) {
    assert(x != y);
}
```

This circuit will prove that the private input `x` is not equal to the public input `y` using a zero-knowledge proof.

Compile Noir(it will also generate a Solidity verifier):

```bash
npx hardhat compile
```

Use the verifier contract in Solidity:

```solidity
// contracts/MyContract.sol
import {HonkVerifier} from "../noir/target/my_noir.sol";

contract MyContract {
    HonkVerifier public verifier = new HonkVerifier();

    function verify(bytes calldata proof, uint256 y) external view returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](1);
        publicInputs[0] = bytes32(y);
        bool result = verifier.verify(proof, publicInputs);
        return result;
    }
}
```

Generate a proof in TypeScript and verify it on chain:

```js
// test/MyContract.test.ts
import { expect } from "chai";
import hre, { ethers } from "hardhat";

it("proves and verifies on-chain", async () => {
  // Deploy a verifier contract
  const contractFactory = await ethers.getContractFactory("MyContract");
  const contract = await contractFactory.deploy();
  await contract.waitForDeployment();

  // Generate a proof
  const { noir, backend } = await hre.noir.getCircuit("my_noir");
  const input = { x: 1, y: 2 };
  const { witness } = await noir.execute(input);
  const { proof, publicInputs } = await backend.generateProof(witness, {
    keccak: true,
  });
  // it matches because we marked y as `pub` in `main.nr`
  expect(BigInt(publicInputs[0])).to.eq(BigInt(input.y));

  // Verify the proof on-chain
  // slice the proof to remove length information
  const result = await contract.verify(proof, input.y);
  expect(result).to.eq(true);

  // You can also verify in JavaScript.
  const resultJs = await backend.verifyProof(
    {
      proof,
      publicInputs: [String(input.y)],
    },
    { keccak: true },
  );
  expect(resultJs).to.eq(true);
});
```

## Tasks

This plugin creates no additional tasks. Run `hardhat compile` to compile Noir.

<!-- This plugin adds the _example_ task to Hardhat:

```
output of `npx hardhat help example`
``` -->

## Environment extensions

This plugin extends the Hardhat Runtime Environment by adding a `noir` field.

You can call `hre.noir.getCircuit(name, backendClass)` to get a compiled circuit JSON.

## Configuration

Configure Noir and Barretenberg (bb) versions in `hardhat.config.ts`:

```js
export default {
  noir: {
    // Noir version, optional, will use the latest known Noir version by default
    version: "1.0.0-beta.6",
  },
};
```

The default folder where Noir is located is `noir`. You can change it in `hardhat.config.js`:

```js
export default {
  paths: {
    noir: "circuits",
  },
};
```
