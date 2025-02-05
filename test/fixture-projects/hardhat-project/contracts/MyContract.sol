// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.27;

import {HonkVerifier} from "../noir2/target/my_circuit.sol";

contract MyContract {
  HonkVerifier public verifier;

  constructor(HonkVerifier _verifier) {
    verifier = _verifier;
  }
}
