// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.27;

import {HonkVerifier} from "../noir2/target/my_circuit.sol";

contract MyContract {
    HonkVerifier public verifier = new HonkVerifier();

    function verify(
        bytes calldata proof,
        uint256 y
    ) external view returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](1);
        publicInputs[0] = bytes32(y);
        bool result = verifier.verify(proof, publicInputs);
        return result;
    }
}
