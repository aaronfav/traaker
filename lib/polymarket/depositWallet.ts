import { deriveDepositWallet } from "@polymarket/builder-relayer-client";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import type { Address, PublicClient } from "viem";

export const DEPOSIT_WALLET_FACTORY = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";

export function deriveUserDepositWallet(ownerAddress: Address) {
  const config = getContractConfig(137).DepositWalletContracts;
  return deriveDepositWallet(ownerAddress, config.DepositWalletFactory, config.DepositWalletImplementation) as Address;
}


export async function getDepositWalletStatus(ownerAddress: Address, publicClient?: PublicClient) {
  const depositWallet = deriveUserDepositWallet(ownerAddress);
  const bytecode = publicClient ? await publicClient.getBytecode({ address: depositWallet }) : undefined;

  return {
    ownerAddress,
    depositWallet,
    initialized: Boolean(bytecode && bytecode !== "0x"),
    factory: DEPOSIT_WALLET_FACTORY,
  };
}
